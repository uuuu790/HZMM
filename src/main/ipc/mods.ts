import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store'
import { getAllPaksPaths, getUe4ssModsPath } from '../services/steam-detector'
import { extractZip, extractRar, extract7z, detectArchiveFormat } from '../services/archive'
import { assertSafeSegment } from '../services/path-safety'
import logger from '../services/logger'
import { scanMods, wasLastScanPartial, isCacheValid, updateCacheState, invalidateCache, getCachedMods } from './mods-scan'
import { syncUe4ssModRegistry, removeFromUe4ssModRegistry, readUe4ssEnabledNames } from './mods-registry'
import { installMods, serializeModWrite } from './mods-install'
import { ALLOWED_MOD_HOSTS, isAllowedModUrl } from './mods-download'
import { pickWinningName, renamePakEverywhere, buildOrderTargets, executeOrderRenames, stripOrderPrefix, isPakFormOfMod, type RenameTarget } from './mods-order'
import type { PreviewMod, PreviewResult, ScannedMod } from './types'

// Re-export for external consumers (tests, etc.)
export { ALLOWED_MOD_HOSTS, isAllowedModUrl }
// Back-compat re-export: resolveModConfigPath moved to mods-config.ts but
// tests/ipc/mods-config-path.test.js imports from mods.ts by path. Keep the
// re-export so the test suite doesn't break.
export { resolveModConfigPath } from './mods-config'

// _hzmm_link.json can ship inside a mod archive, so its names are untrusted:
// only flat pak-family names, and never the base game's own paks
// (pakchunk*/global.* outside ~mods, where a mod may use those names).
function isLinkablePak(name: string, paksDir: string): boolean {
  if (!/\.(pak|ucas|utoc)$/i.test(name)) return false
  try { assertSafeSegment('linkedPak', name) } catch { return false }
  return path.basename(paksDir).toLowerCase() === '~mods' || !/^(pakchunk\d+|global\.)/i.test(name)
}

// Enable or disable every pak a hybrid's link lists.
function setLinkedPaksEnabled(paksPaths: string[], linkedPaks: unknown, enabled: boolean): void {
  for (const pakName of Array.isArray(linkedPaks) ? linkedPaks : []) {
    if (typeof pakName !== 'string') continue
    const baseName = pakName.replace('.disabled', '')
    for (const pp of paksPaths) {
      if (!isLinkablePak(baseName, pp)) continue
      const enabledPath = path.join(pp, baseName)
      const disabledPath = path.join(pp, baseName + '.disabled')
      if (!enabled && fs.existsSync(enabledPath)) {
        // 要禁用 → .pak → .pak.disabled
        fs.renameSync(enabledPath, disabledPath)
        logger.info(`Hybrid PAK toggled: ${baseName} → disabled`)
      } else if (enabled && fs.existsSync(disabledPath)) {
        // 要啟用 → .pak.disabled → .pak
        fs.renameSync(disabledPath, enabledPath)
        logger.info(`Hybrid PAK toggled: ${baseName} → enabled`)
      }
    }
  }
}

// Delete every pak a hybrid's link lists.
function removeLinkedPaks(paksPaths: string[], linkedPaks: unknown): void {
  for (const pakName of Array.isArray(linkedPaks) ? linkedPaks : []) {
    if (typeof pakName !== 'string') continue
    const baseName = pakName.replace('.disabled', '')
    for (const pp of paksPaths) {
      if (!isLinkablePak(baseName, pp)) continue
      const ep = path.join(pp, baseName)
      const dp = path.join(pp, baseName + '.disabled')
      if (fs.existsSync(ep)) { fs.unlinkSync(ep); logger.info(`Hybrid PAK removed: ${baseName}`); break }
      if (fs.existsSync(dp)) { fs.unlinkSync(dp); logger.info(`Hybrid PAK removed: ${baseName}.disabled`); break }
    }
  }
}

function linkListsPak(pakFiles: unknown, baseName: string): boolean {
  return Array.isArray(pakFiles) && pakFiles.some(p => typeof p === 'string' && p.replace('.disabled', '') === baseName)
}

// Every entry of the paks dirs; a dir that can't be read is skipped.
function listPaksDirFiles(paksPaths: string[]): string[] {
  const files: string[] = []
  for (const pp of paksPaths) {
    try { files.push(...fs.readdirSync(pp)) } catch { /* directory may not exist yet — skip */ }
  }
  return files
}

// serializeModWrite (the shared write mutex) is imported from mods-install.ts
// so toggle/remove here share ONE chain with every install path — preventing a
// Nexus/URL install from interleaving with a toggle on the same files.
//
// Core mod IPC: scan / toggle / install / remove / preview / URL-install.
// Config / profile snapshot / readme handlers live in sibling modules
// (mods-config.ts, mods-profiles.ts, mods-readme.ts) — see main/index.ts
// for the wiring.
function registerModsIpc(mainWindow: BrowserWindow | null | undefined): void {
  // --- Scan ---
  ipcMain.handle('mods:scan', () => {
    let cached: ScannedMod[]
    if (isCacheValid()) {
      cached = getCachedMods()
    } else {
      cached = scanMods()
      // Don't cache a partial scan: the dir mtimes don't change once the read
      // error clears, so the incomplete list would stick.
      if (wasLastScanPartial()) invalidateCache()
      else updateCacheState(cached)
    }
    // Shallow-copy each mod before merging custom names so we never mutate the
    // long-lived cache (which would leave stale customName on cleared mods).
    const customNames: Record<string, string> = configStore.get('modCustomNames', {})
    return cached.map(mod => {
      const copy: ScannedMod & { customName?: string } = { ...mod }
      if (customNames[mod.id]) copy.customName = customNames[mod.id]
      else delete copy.customName
      return copy
    })
  })

  ipcMain.handle('mods:invalidate-cache', () => {
    invalidateCache()
  })

  // --- Custom Name ---
  ipcMain.handle('mods:set-custom-name', (_: IpcMainInvokeEvent, modId: unknown, customName: unknown) => {
    if (typeof modId !== 'string' || !modId) throw new Error('Invalid mod ID')
    if (modId.length > 260) throw new Error('Mod ID too long')
    const names = configStore.get('modCustomNames', {})
    if (customName && typeof customName === 'string' && customName.trim()) {
      // Cap at 200 chars — well beyond any reasonable mod title but keeps
      // a malicious renderer from ballooning config.json to MBs.
      const trimmed = customName.trim().slice(0, 200)
      names[modId] = trimmed
    } else {
      delete names[modId]
    }
    configStore.set('modCustomNames', names)
  })

  // --- Toggle ---
  // Serialized with install/remove so concurrent operations on the same
  // mod's enabled.txt / pak rename / mods.txt don't interleave.
  ipcMain.handle('mods:toggle', (_: IpcMainInvokeEvent, filename: unknown) => serializeModWrite(() => {
    assertSafeSegment('filename', filename)
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const isPakMod = filename.endsWith('.pak') || filename.endsWith('.pak.disabled')

    if (!isPakMod) {
      // UE4SS / Hybrid mod toggle — filename 是資料夾名
      const ue4ssModsPath = getUe4ssModsPath(gamePath)
      if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')

      const modDir = path.join(ue4ssModsPath, filename)
      if (!fs.existsSync(modDir)) throw new Error(`Mod folder not found: ${filename}`)

      const enabledFile = path.join(modDir, 'enabled.txt')
      // Same rule as scanMods: a mod listed as enabled in mods.txt / mods.json
      // is enabled even without an enabled.txt marker.
      const isEnabled = fs.existsSync(enabledFile) || readUe4ssEnabledNames(ue4ssModsPath).has(filename)

      if (isEnabled) {
        if (fs.existsSync(enabledFile)) fs.unlinkSync(enabledFile)
      } else {
        fs.writeFileSync(enabledFile, '', 'utf-8')
      }

      // Sync mods.txt / mods.json
      syncUe4ssModRegistry(ue4ssModsPath, filename, !isEnabled)

      // Hybrid 連動：一起切換關聯的 PAK
      const linkFile = path.join(modDir, '_hzmm_link.json')
      if (fs.existsSync(linkFile)) {
        try {
          const { pakFiles: linkedPaks } = JSON.parse(fs.readFileSync(linkFile, 'utf-8'))
          setLinkedPaksEnabled(getAllPaksPaths(gamePath), linkedPaks, !isEnabled)
        } catch (err) {
          logger.warn(`Failed to toggle hybrid PAK: ${(err as Error).message}`)
        }
      }

      invalidateCache()
      logger.info(`Mod toggled: ${filename} → ${!isEnabled ? 'enabled' : 'disabled'}`)
      return {
        id: `ue4ss:${filename}`,
        filename,
        enabled: !isEnabled,
        path: modDir
      }
    }

    // PAK mod toggle — search across ALL paks paths
    const paksPaths = getAllPaksPaths(gamePath)
    let filePath: string | null = null
    for (const paksPath of paksPaths) {
      const candidate = path.join(paksPath, filename)
      if (fs.existsSync(candidate)) {
        filePath = candidate
        break
      }
    }

    if (!filePath) throw new Error(`File not found: ${filename}`)

    let newPath: string
    if (filename.endsWith('.pak.disabled')) {
      newPath = filePath.replace('.disabled', '')
    } else {
      newPath = filePath + '.disabled'
    }

    fs.renameSync(filePath, newPath)
    const pakNowEnabled = newPath.endsWith('.pak')

    // Hybrid 反向連動：toggle PAK 時也 toggle 關聯的 UE4SS
    const ue4ssModsPath2 = getUe4ssModsPath(gamePath)
    if (ue4ssModsPath2) {
      const baseName = filename.replace('.disabled', '')
      try {
        const registryEnabled = readUe4ssEnabledNames(ue4ssModsPath2)
        // Visit ALL matching link files — multiple UE4SS mods can legitimately
        // reference the same PAK (e.g. after a manual edit or reinstall that
        // duplicated a link). Previous code only toggled the first match and
        // silently left the rest out of sync.
        for (const dir of fs.readdirSync(ue4ssModsPath2)) {
          const linkFile = path.join(ue4ssModsPath2, dir, '_hzmm_link.json')
          if (!fs.existsSync(linkFile)) continue
          const { pakFiles } = JSON.parse(fs.readFileSync(linkFile, 'utf-8'))
          if (!linkListsPak(pakFiles, baseName)) continue
          const enabledFile = path.join(ue4ssModsPath2, dir, 'enabled.txt')
          const dirEnabled = fs.existsSync(enabledFile) || registryEnabled.has(dir)
          if (pakNowEnabled && !dirEnabled) {
            fs.writeFileSync(enabledFile, '', 'utf-8')
            // Keep mods.txt/mods.json in step with enabled.txt, exactly like
            // the direct UE4SS toggle path above — otherwise the registry
            // drifts out of sync with the linked mod's real enabled state.
            syncUe4ssModRegistry(ue4ssModsPath2, dir, true)
            logger.info(`Hybrid UE4SS toggled: ${dir} → enabled`)
          } else if (!pakNowEnabled && dirEnabled) {
            if (fs.existsSync(enabledFile)) fs.unlinkSync(enabledFile)
            syncUe4ssModRegistry(ue4ssModsPath2, dir, false)
            logger.info(`Hybrid UE4SS toggled: ${dir} → disabled`)
          }
          // The hybrid's other paks follow, or it ends up half-enabled.
          try { setLinkedPaksEnabled(paksPaths, pakFiles, pakNowEnabled) } catch (err) {
            logger.warn(`Failed to toggle hybrid PAKs of ${dir}: ${(err as Error).message}`)
          }
        }
      } catch (err) {
        logger.warn(`Failed to toggle hybrid UE4SS: ${(err as Error).message}`)
      }
    }

    invalidateCache()
    logger.info(`Mod toggled: ${filename} → ${pakNowEnabled ? 'enabled' : 'disabled'}`)
    return {
      id: path.basename(newPath).replace('.disabled', ''),
      filename: path.basename(newPath),
      enabled: pakNowEnabled,
      path: newPath
    }
  }))

  // --- Load order: make a pak win its conflict group ---
  // UE mounts ~mods paks alphabetically, later wins. Rename the chosen pak
  // with an escalating z<N>_ prefix so it sorts after every competitor, and
  // migrate every filename-keyed store (profiles / receipts / custom names /
  // hybrid links) in the same mutex task.
  ipcMain.handle('mods:make-pak-win', (_: IpcMainInvokeEvent, filename: unknown, competitors: unknown) => serializeModWrite(() => {
    assertSafeSegment('filename', filename)
    if (!Array.isArray(competitors) || competitors.length === 0) throw new Error('No competitors provided')
    for (const c of competitors) assertSafeSegment('competitor', c)
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const newFilename = pickWinningName(filename, competitors)
    if (newFilename === filename) return { filename, renamed: false }

    try {
      renamePakEverywhere(
        { paksPaths: getAllPaksPaths(gamePath), ue4ssModsPath: getUe4ssModsPath(gamePath) },
        filename,
        newFilename
      )
    } finally {
      invalidateCache()
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mods:updated')
    }
    return { filename: newFilename, renamed: true }
  }))

  // --- Load order: apply a full drag-and-drop sequence ---
  // Renumbers every pak to NNN_<core> so the on-disk alphabetical order equals
  // the dragged sequence (no-op when it already does). executeOrderRenames
  // handles swap cycles; every rename migrates the filename-keyed stores.
  ipcMain.handle('mods:apply-pak-order', (_: IpcMainInvokeEvent, orderedFilenames: unknown) => serializeModWrite(() => {
    if (!Array.isArray(orderedFilenames) || orderedFilenames.length === 0) throw new Error('No order provided')
    const seen = new Set<string>()
    const normalized = orderedFilenames.map((fn: unknown) => {
      assertSafeSegment('filename', fn)
      // Load order is defined by the ENABLED-form name (what the engine will
      // mount once the mod is re-enabled); renamePakEverywhere resolves the
      // on-disk .disabled twin itself.
      const enabledForm = fn.replace(/\.disabled$/i, '')
      const key = enabledForm.toLowerCase()
      if (seen.has(key)) throw new Error(`Duplicate filename in order: ${fn}`)
      seen.add(key)
      return enabledForm
    })
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const targets = buildOrderTargets(normalized)
    if (targets.length === 0) return { renamed: 0, skipped: 0, changed: false }

    const paksPaths = getAllPaksPaths(gamePath)
    const modPaths = { paksPaths, ue4ssModsPath: getUe4ssModsPath(gamePath) }
    const exists = (name: string) => paksPaths.some((pp: string) =>
      fs.existsSync(path.join(pp, name)) || fs.existsSync(path.join(pp, `${name}.disabled`)))
    const done: RenameTarget[] = []
    try {
      const summary = executeOrderRenames(targets, {
        exists,
        rename: (from, to) => {
          renamePakEverywhere(modPaths, from, to)
          done.push({ from, to })
        },
      })
      logger.info(`Load order applied: ${summary.renamed} renamed, ${summary.skipped} skipped`)
      return { ...summary, changed: summary.renamed > 0 }
    } catch (err) {
      // A rename failed midway (e.g. a pak the running game holds open): undo
      // the ones that landed so the old order is left intact, not half-applied.
      for (const { from, to } of done.reverse()) {
        try { renamePakEverywhere(modPaths, to, from) } catch (undoErr) {
          logger.warn(`Load order: could not undo ${from} → ${to}: ${(undoErr as Error).message}`)
        }
      }
      throw err
    } finally {
      invalidateCache()
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mods:updated')
    }
  }))

  // --- Install ---
  // installMods serializes its own write phase internally (and validates
  // filePaths), so we must NOT wrap it in serializeModWrite again here —
  // double-wrapping deadlocks (outer task awaits inner, inner queued behind it).
  ipcMain.handle('mods:install', (_: IpcMainInvokeEvent, filePaths: unknown) => installMods(filePaths, mainWindow))

  // --- Remove ---
  // Serialized with install/toggle so concurrent operations don't
  // interleave on the same hybrid link files / mods.txt.
  ipcMain.handle('mods:remove', (_: IpcMainInvokeEvent, filename: unknown) => serializeModWrite(() => {
    assertSafeSegment('filename', filename)
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const isPakMod = filename.endsWith('.pak') || filename.endsWith('.pak.disabled')

    if (!isPakMod) {
      // UE4SS mod removal — filename 是資料夾名
      const ue4ssModsPath = getUe4ssModsPath(gamePath)
      if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')

      const modDir = path.join(ue4ssModsPath, filename)

      // Hybrid 連動：一起刪除關聯的 PAK
      const linkFile = path.join(modDir, '_hzmm_link.json')
      if (fs.existsSync(linkFile)) {
        try {
          const { pakFiles: linkedPaks } = JSON.parse(fs.readFileSync(linkFile, 'utf-8'))
          removeLinkedPaks(getAllPaksPaths(gamePath), linkedPaks)
        } catch (err) { logger.warn(`Failed to remove hybrid PAK: ${(err as Error).message}`) }
      }

      if (fs.existsSync(modDir)) {
        fs.rmSync(modDir, { recursive: true, force: true })
      }
      // Remove from mods.txt / mods.json
      removeFromUe4ssModRegistry(ue4ssModsPath, filename)
      invalidateCache()
      // Notify renderer so downstream consumers (Nexus installed-badge tracker)
      // can reconcile their state against the now-shrunk local mod inventory.
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mods:updated')
      logger.info(`Mod removed: ${filename}`)
      return true
    }

    // PAK mod removal — search across ALL paks paths
    const paksPaths = getAllPaksPaths(gamePath)
    let found = false
    for (const paksPath of paksPaths) {
      const filePath = path.join(paksPath, filename)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        found = true
        // The pak's IoStore containers share its stem; don't leave them behind.
        const stem = filename.replace(/\.pak(\.disabled)?$/i, '')
        for (const ext of ['.ucas', '.utoc']) {
          for (const suffix of ['', '.disabled']) {
            const sibling = path.join(paksPath, `${stem}${ext}${suffix}`)
            if (!fs.existsSync(sibling)) continue
            try { fs.unlinkSync(sibling) } catch (err) {
              logger.warn(`Failed to remove ${stem}${ext}${suffix}: ${(err as Error).message}`)
            }
          }
        }
        break
      }
    }

    if (!found) throw new Error(`PAK file not found: ${filename}`)

    // Clean up saved readme for PAK mod. Install keys it by the un-prefixed
    // name, so a load-order-renamed pak (z1_Foo_P.pak) owns readmes/Foo.txt
    // too, unless another form of Foo is still installed.
    const modName = filename.replace(/\.(pak|pak\.disabled)$/i, '').replace(/_P$/, '')
    const readmeNames = [modName]
    const coreName = stripOrderPrefix(modName)
    if (coreName !== modName && !listPaksDirFiles(paksPaths).some(f => isPakFormOfMod(f, coreName))) readmeNames.push(coreName)
    for (const name of readmeNames) {
      const readmePath = path.join(configStore.getConfigDir(), 'readmes', `${name}.txt`)
      if (fs.existsSync(readmePath)) { try { fs.unlinkSync(readmePath) } catch { /* readme cleanup is best-effort */ } }
    }

    // Hybrid 反向連動：刪 PAK 時也刪關聯的 UE4SS
    const ue4ssModsPath2 = getUe4ssModsPath(gamePath)
    if (ue4ssModsPath2) {
      const baseName = filename.replace('.disabled', '')
      try {
        for (const dir of fs.readdirSync(ue4ssModsPath2)) {
          const linkFile = path.join(ue4ssModsPath2, dir, '_hzmm_link.json')
          if (!fs.existsSync(linkFile)) continue
          const { pakFiles } = JSON.parse(fs.readFileSync(linkFile, 'utf-8'))
          if (!linkListsPak(pakFiles, baseName)) continue
          // Take the hybrid's other paks along instead of leaving them unowned.
          try { removeLinkedPaks(paksPaths, pakFiles) } catch (err) {
            logger.warn(`Failed to remove hybrid PAKs of ${dir}: ${(err as Error).message}`)
          }
          fs.rmSync(path.join(ue4ssModsPath2, dir), { recursive: true, force: true })
          removeFromUe4ssModRegistry(ue4ssModsPath2, dir)
          logger.info(`Hybrid UE4SS removed: ${dir}`)
          break
        }
      } catch (err) { logger.warn(`Failed to remove hybrid UE4SS: ${(err as Error).message}`) }
    }

    invalidateCache()
    // Notify renderer so downstream consumers (Nexus installed-badge tracker)
    // can reconcile their state against the now-shrunk local mod inventory.
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mods:updated')
    logger.info(`Mod removed: ${filename}`)
    return true
  }))

  // --- Install Preview ---
  ipcMain.handle('mods:preview', async (_: IpcMainInvokeEvent, filePaths: unknown) => {
    // Same trust-boundary validation as installMods — preview reads / extracts
    // the given archives, so reject non-absolute or non-.zip/.rar/.7z/.pak inputs.
    if (!Array.isArray(filePaths)) throw new Error('Invalid file list')
    for (const fp of filePaths) {
      if (typeof fp !== 'string' || !path.isAbsolute(fp)) throw new Error(`Invalid file path: ${String(fp)}`)
      const ext = path.extname(fp).toLowerCase()
      if (ext !== '.zip' && ext !== '.rar' && ext !== '.7z' && ext !== '.pak') throw new Error(`Unsupported file type: ${path.basename(fp)}`)
    }
    const gamePath = configStore.get('gamePath')
    const allPaksPaths = gamePath ? getAllPaksPaths(gamePath) : []
    const ue4ssModsPath = gamePath ? getUe4ssModsPath(gamePath) : null

    // On-disk paks-dir entries for the "Reinstall" flag, matched with the same
    // isPakFormOfMod the install rotation uses (load-order prefixes, _P or
    // plain, .disabled, .ucas/.utoc) so the flag shows exactly when the
    // install will replace something.
    const pakDirFiles = listPaksDirFiles(allPaksPaths)
    const existingUe4ss = new Set<string>()
    if (ue4ssModsPath && fs.existsSync(ue4ssModsPath)) {
      try {
        for (const d of fs.readdirSync(ue4ssModsPath)) {
          if (fs.statSync(path.join(ue4ssModsPath, d)).isDirectory()) {
            existingUe4ss.add(d.toLowerCase())
          }
        }
      } catch { /* directory may not exist yet — skip */ }
    }

    const results: PreviewResult[] = []
    for (const filePath of filePaths as string[]) { // every entry was checked above
      const ext = path.extname(filePath).toLowerCase()
      try {
        let mods: PreviewMod[] = []
        let type = 'unknown'
        let totalFiles = 0

        if (ext === '.pak') {
          const name = path.basename(filePath).replace(/\.(pak|pak\.disabled)$/i, '').replace(/_P$/, '')
          mods = [{ name, modType: 'PAK' }]
          type = 'pak-only'
          totalFiles = 1
        } else {
          // Extension is advisory (Nexus GUID CDN downloads are named .zip
          // regardless of content) — sniff magic bytes like installMods does.
          const format = detectArchiveFormat(filePath)
          const analyzers: Partial<Record<string, typeof extractZip>> = { zip: extractZip, rar: extractRar, '7z': extract7z }
          const analyzeFn = analyzers[format]
          if (!analyzeFn) {
            throw new Error(`${path.basename(filePath)} is not a valid zip/rar/7z archive`)
          }
          const analysis = await analyzeFn(filePath, null, true)
          mods = analysis.mods || []
          type = analysis.type
          totalFiles = (analysis.entryNames || []).filter(n => !n.endsWith('/')).length
        }

        // Check each mod for existing conflicts
        for (const mod of mods) {
          if (mod.modType === 'PAK' && pakDirFiles.some(f => isPakFormOfMod(f, mod.name))) {
            mod.existing = true
          } else if (mod.modType === 'UE4SS' && existingUe4ss.has(mod.name.toLowerCase())) {
            mod.existing = true
          }
        }

        results.push({ filePath, fileName: path.basename(filePath), type, mods, totalFiles })
      } catch (err) {
        logger.error(`Preview failed for ${filePath}: ${(err as Error).message}`)
        results.push({ filePath, fileName: path.basename(filePath), type: 'unknown', mods: [], totalFiles: 0, error: (err as Error).message })
      }
    }
    return results
  })

}

export { registerModsIpc, scanMods }
