import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store'
import { getPaksPath, getAllPaksPaths, getUe4ssModsPath } from '../services/steam-detector'
import { extractZip, extractRar, extract7z, detectArchiveFormat, copyFile, readZipEntryHead } from '../services/archive'
import type { ArchiveAnalysis, Ue4ssModDir } from '../services/archive'
import logger from '../services/logger'
import { normalizeReadme, MAX_README_CHARS } from '../services/readme-utils'
import { invalidateCache } from './mods-scan'
import { syncUe4ssModRegistry } from './mods-registry'
import { isPakFormOfMod } from './mods-order'
import { assertSafeSegment } from '../services/path-safety'
import type { BrowserWindow } from 'electron'
import type { InstalledArchive, InstallError } from './types'

/** A mod's identity as rotation / partial cleanup need it (archive analysis or receipt). */
interface ModRef {
  name: string
  modType: string
}

interface MovedFile {
  from: string
  to: string
}

// Serializes the on-disk write phase of every mod mutation. installMods (this
// file) wraps its work in this; mods.ts imports it for toggle/remove. Sharing
// ONE chain across all of them stops concurrent IPC calls (e.g. a Nexus install
// landing while the user toggles a mod) from interleaving on the same
// ~mods / enabled.txt / mods.json / hybrid-link files and corrupting state.
let modWriteChain: Promise<unknown> = Promise.resolve()
function serializeModWrite<T>(task: () => T | Promise<T>): Promise<T> {
  const next = modWriteChain.then(() => task())
  modWriteChain = next.catch(() => {})
  return next
}

const PAK_FILE_RE = /\.(pak|ucas|utoc)$/i

// `skipFile` (optional) leaves out files by name, at any depth.
function copyDirSync(src: string, dest: string, skipFile?: (name: string) => boolean): void {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src)
  for (const entry of entries) {
    const srcPath = path.join(src, entry)
    const destPath = path.join(dest, entry)
    const stat = fs.statSync(srcPath)
    if (stat.isDirectory()) {
      copyDirSync(srcPath, destPath, skipFile)
    } else if (!skipFile?.(entry)) {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// Move a tree into `dest`, merging into existing folders and replacing files
// (same overwrite semantics as extracting there directly).
function mergeMoveDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src)) {
    const from = path.join(src, entry)
    const to = path.join(dest, entry)
    if (fs.lstatSync(from).isDirectory()) mergeMoveDir(from, to)
    else fs.renameSync(from, to)
  }
}

// renameSync throws EXDEV across volumes (e.g. game on D:, %APPDATA% on C:).
// Fall back to copy + remove so the rotate-on-overwrite flow works regardless
// of which drive the user installs HumanitZ on.
function moveAcrossVolume(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    if (fs.statSync(src).isDirectory()) {
      copyDirSync(src, dest)
      fs.rmSync(src, { recursive: true, force: true })
    } else {
      fs.copyFileSync(src, dest)
      fs.unlinkSync(src)
    }
  }
}

// Copy the archive's UE4SS mod folders (located by analyzeArchiveStructure, so
// they match the names rotation moved aside and the registry will enable)
// from the extract in `tempDir` into the UE4SS Mods folder. A mod at the
// archive root leaves its paks out: those go to the paks folder. Returns how
// many folders were copied; a folder missing from the extract throws, since
// its live copy was already rotated aside.
function copyUe4ssModDirs(tempDir: string, dirs: readonly Ue4ssModDir[], ue4ssModsPath: string): number {
  for (const { name, dir } of dirs) {
    const src = dir ? path.join(tempDir, dir) : tempDir
    if (!fs.existsSync(src)) throw new Error(`UE4SS mod folder "${name}" missing from the extracted archive`)
    copyDirSync(src, path.join(ue4ssModsPath, name), dir ? undefined : (f) => PAK_FILE_RE.test(f))
  }
  return dirs.length
}

// Same-basename paks from different archive folders land as 'Cool_P (2).pak'
// (resolveCollisionFreePath); those copies belong to the mod as well.
const COLLISION_SUFFIX_RE = / \(\d+\)(?=\.(?:pak|ucas|utoc)(?:\.disabled)?$)/i
function isPakFileOfMod(filename: string, modName: string): boolean {
  return isPakFormOfMod(filename, modName) || isPakFormOfMod(filename.replace(COLLISION_SUFFIX_RE, ''), modName)
}

// Move (not delete) existing mod files into a backup folder so a failed
// install can restore them. Pushes each { from, to } into the caller-supplied
// `moved` array IMMEDIATELY after every successful move (and returns it), so a
// throw partway through (EPERM/EBUSY on a locked pak, ENOSPC in the cross-volume
// branch) still leaves the already-rotated entries visible to withRollback's
// catch — otherwise those originals would be silently destroyed.
function rotateModsToBackup(gamePath: string, mods: readonly ModRef[], backupRoot: string, moved: MovedFile[] = []): MovedFile[] {
  const allPaksPaths = getAllPaksPaths(gamePath)
  const ue4ssModsPath = getUe4ssModsPath(gamePath)
  let counter = 0

  for (const mod of mods) {
    // Defense in depth: mod.name is derived from archive entry paths and reaches
    // moveAcrossVolume (a destructive move) and the path.join targets below.
    // analyzeArchiveStructure already drops traversal names; re-check here so no
    // crafted name can build an fs target that escapes the mods/paks roots.
    try {
      assertSafeSegment('modName', mod.name)
    } catch {
      logger.warn(`Skipping mod with unsafe name during rollback rotation: ${String(mod.name)}`)
      continue
    }
    if (mod.modType === 'PAK') {
      // Directory scan with the prefix-aware matcher, not a fixed candidate
      // list: mod.name comes from the NEW archive (no order prefix), but the
      // outgoing file may carry one (z1_Cool for Cool, via conflict "make it
      // win"). Missing it would leave old and new pak side by side — and the
      // z1_ old version keeps winning the alphabetical mount order.
      for (const pp of allPaksPaths) {
        let names: string[] = []
        try { names = fs.readdirSync(pp) } catch { continue /* paks dir missing/unreadable */ }
        for (const fn of names) {
          if (!isPakFileOfMod(fn, mod.name)) continue
          const fp = path.join(pp, fn)
          const bp = path.join(backupRoot, `${counter++}_${fn}`)
          moveAcrossVolume(fp, bp)
          moved.push({ from: fp, to: bp })
        }
      }
      const readmePath = path.join(configStore.getConfigDir(), 'readmes', `${mod.name}.txt`)
      if (fs.existsSync(readmePath)) {
        const bp = path.join(backupRoot, `${counter++}_readme_${mod.name}.txt`)
        try { moveAcrossVolume(readmePath, bp); moved.push({ from: readmePath, to: bp }) } catch { /* best-effort */ }
      }
    } else if (mod.modType === 'UE4SS' && ue4ssModsPath) {
      const modDir = path.join(ue4ssModsPath, mod.name)
      if (fs.existsSync(modDir)) {
        const bp = path.join(backupRoot, `${counter++}_ue4ss_${mod.name}`)
        moveAcrossVolume(modDir, bp)
        moved.push({ from: modDir, to: bp })
      }
    }
  }
  return moved
}

// Remove (partial) files a failed extract wrote for the archive's paks.
// restoreFromBackup only cleans each entry's rotated `from` path — which since
// the prefix-aware rotation may be z1_Cool_P.pak while the extract wrote
// Cool_P.pak (or a collision copy 'Cool_P (2).pak'), so a corrupt half-written
// pak would otherwise survive next to the restored original. Same matcher as
// rotateModsToBackup: once rotation completed, every match on disk is new.
// Paths restoreFromBackup owns are skipped.
function removeLandedPakPartials(gamePath: string, mods: readonly ModRef[], moved: readonly MovedFile[]): void {
  const movedFrom = new Set(moved.map(m => String(m.from).toLowerCase()))
  const pakMods = mods.filter((mod) => {
    if (mod.modType !== 'PAK') return false
    try { assertSafeSegment('modName', mod.name); return true } catch { return false }
  })
  if (pakMods.length === 0) return
  for (const pp of getAllPaksPaths(gamePath)) {
    let names: string[] = []
    try { names = fs.readdirSync(pp) } catch { continue }
    for (const fn of names) {
      if (!pakMods.some(mod => isPakFileOfMod(fn, mod.name))) continue
      const fp = path.join(pp, fn)
      if (movedFrom.has(fp.toLowerCase())) continue
      try { fs.unlinkSync(fp) } catch { /* best-effort */ }
    }
  }
}

// Put backed-up originals back where they were (removing partial-extract
// leftovers at the destination first). Returns the entries that FAILED to
// restore so the caller can decide whether the backup folder is still needed —
// a failed move means the original's only surviving copy is still in backup.
function restoreFromBackup(moved: readonly MovedFile[]): MovedFile[] {
  const failed: MovedFile[] = []
  for (const { from, to } of moved) {
    try {
      if (fs.existsSync(from)) {
        if (fs.statSync(from).isDirectory()) fs.rmSync(from, { recursive: true, force: true })
        else fs.unlinkSync(from)
      }
      moveAcrossVolume(to, from)
    } catch (err) {
      logger.error(`Rollback failed for ${from}: ${(err as Error).message}`)
      failed.push({ from, to })
    }
  }
  return failed
}

// Run `work` with all of `mods`' existing on-disk artifacts moved aside.
// On success: drop the backup. On throw: restore the originals (after
// cleaning any partial new files) and rethrow. Use instead of
// cleanExistingMod so a mid-extract failure doesn't leave the user with
// no old version AND no working new version.
async function withRollback<T>(gamePath: string, mods: readonly ModRef[] | null | undefined, work: () => T | Promise<T>): Promise<T> {
  if (!mods || mods.length === 0) return work()
  const backupRoot = path.join(configStore.getConfigDir(), 'install-rollback', String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8))
  fs.mkdirSync(backupRoot, { recursive: true })
  // Build the `moved` list here and hand it to rotateModsToBackup so entries
  // are recorded incrementally: a mid-rotation throw still leaves the partial
  // list visible to the catch below, which then restores those originals.
  const moved: MovedFile[] = []
  // Partial-cleanup is only safe once rotation COMPLETED: before that, a file
  // at a landed name may be the ORIGINAL that a mid-rotation throw (EBUSY /
  // ENOSPC) left in place — deleting it would destroy the only copy.
  let rotated = false
  let result: T
  try {
    rotateModsToBackup(gamePath, mods, backupRoot, moved)
    rotated = true
    result = await work()
  } catch (err) {
    if (rotated) removeLandedPakPartials(gamePath, mods, moved)
    const failedRestores = restoreFromBackup(moved)
    if (failedRestores.length === 0) {
      try { fs.rmSync(backupRoot, { recursive: true, force: true }) } catch { /* best-effort */ }
    } else {
      // Some originals couldn't be put back — their only copy is still in
      // backupRoot. Do NOT delete it (that would lose both the old version AND
      // the failed new one); surface the location so the user can recover.
      (err as InstallError).backupRetained = backupRoot
      logger.error(`Install rollback incomplete — originals preserved at ${backupRoot}`)
    }
    throw err
  }
  // The install has landed: a backup that can't be deleted (AV / indexer lock
  // on Windows) must not turn it into a rollback. cleanupStaleRollback sweeps
  // whatever is left.
  try {
    fs.rmSync(backupRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch (err) {
    logger.warn(`Could not remove install backup ${backupRoot}: ${(err as Error).message}`)
  }
  return result
}

// On startup, surface any leftover install-rollback dirs. They persist only
// when a restore couldn't complete (originals deliberately preserved, see
// err.backupRetained above) OR the process was hard-killed mid-install
// (originals rotated aside, extract never finished). We do NOT auto-delete
// recent ones — they may hold a mod's ONLY copy — but we log the location so
// the user can recover, and sweep ones old enough (>7 days) to be abandoned.
function cleanupStaleRollback(): void {
  try {
    const rollbackRoot = path.join(configStore.getConfigDir(), 'install-rollback')
    if (!fs.existsSync(rollbackRoot)) return
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000
    for (const name of fs.readdirSync(rollbackRoot)) {
      const dir = path.join(rollbackRoot, name)
      let stat: fs.Stats
      try { stat = fs.statSync(dir) } catch { continue }
      if (!stat.isDirectory()) continue
      if (Date.now() - stat.mtimeMs > WEEK_MS) {
        try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ }
        logger.info(`Swept abandoned install-rollback dir (>7d): ${dir}`)
      } else {
        logger.warn(`Leftover install-rollback dir may hold recoverable mod files: ${dir}`)
      }
    }
  } catch (err) {
    logger.warn(`Failed to scan install-rollback: ${(err as Error).message}`)
  }
}

type MainWindow = BrowserWindow | null | undefined
type ExtractFn = typeof extractZip

// Extract into the game root. A game-structure archive wrapped in one folder
// ('MyMod v1.0/HumanitZ/...') goes to a temp dir first (same volume) and only
// its HumanitZ/ tree is merged into the game folder: a readme, screenshots or
// optional folders next to it must not land loose in the game root.
async function extractToGameRoot(extractFn: ExtractFn, filePath: string, gamePath: string, prefix: string | undefined): Promise<void> {
  if (!prefix) {
    await extractFn(filePath, gamePath)
    return
  }
  const tempDir = path.join(gamePath, '_hzmm_gs_temp')
  try {
    fs.rmSync(tempDir, { recursive: true, force: true })
    await extractFn(filePath, tempDir)
    const wrapper = path.join(tempDir, prefix)
    for (const entry of fs.readdirSync(wrapper)) {
      const from = path.join(wrapper, entry)
      if (entry.toLowerCase() === 'humanitz' && fs.lstatSync(from).isDirectory()) mergeMoveDir(from, path.join(gamePath, entry))
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

// The files a root extract writes, as game paths: every entry, or for a
// wrapped archive only its HumanitZ/ tree (see extractToGameRoot).
function rootExtractTargets(gamePath: string, analysis: ArchiveAnalysis): string[] {
  const prefix = analysis.gameStructurePrefix ?? ''
  const kept = prefix ? `${prefix}HumanitZ/`.toLowerCase() : ''
  return (analysis.entryNames || [])
    .filter(n => !n.endsWith('/') && n.toLowerCase().startsWith(kept))
    .map(n => path.join(gamePath, n.slice(prefix.length)))
}

// The paks among them that land under a Paks folder the game has, at any
// depth: the engine mounts Paks recursively. Paks written anywhere else (a
// complex archive dumped into the game root) load nowhere.
function rootExtractPaks(gamePath: string, analysis: ArchiveAnalysis): string[] {
  const paksRoots = [path.join(gamePath, 'HumanitZ', 'Content', 'Paks'), path.join(gamePath, 'Content', 'Paks')]
    .filter(p => fs.existsSync(p))
    .map(p => p.toLowerCase() + path.sep)
  return rootExtractTargets(gamePath, analysis)
    .filter(fp => PAK_FILE_RE.test(fp) && paksRoots.some(root => fp.toLowerCase().startsWith(root)))
}

// Only the mods a root extract actually replaces may be rotated aside: any
// other live copy would be moved into the backup and deleted with it once the
// extract "succeeds". A PAK mod is replaced when one of its paks lands in the
// game's Paks tree (an old copy left in Paks/ or ~mods/ would otherwise still
// load next to the new one), a UE4SS mod when files land in its folder.
function modsReplacedByRootExtract(gamePath: string, analysis: ArchiveAnalysis): ModRef[] {
  const landed = rootExtractTargets(gamePath, analysis).map(fp => fp.toLowerCase())
  const landedPaks = rootExtractPaks(gamePath, analysis).map(fp => path.basename(fp))
  const ue4ssModsPath = getUe4ssModsPath(gamePath)
  return (analysis.mods || []).filter((mod) => {
    if (mod.modType === 'PAK') {
      return landedPaks.some(fn => isPakFormOfMod(fn, mod.name))
    }
    if (mod.modType === 'UE4SS' && ue4ssModsPath) {
      const modDir = path.join(ue4ssModsPath, mod.name).toLowerCase() + path.sep
      return landed.some(fp => fp.startsWith(modDir))
    }
    return false
  })
}

function installMods(filePaths: unknown, mainWindow: MainWindow): Promise<InstalledArchive[]> {
  // Validate renderer-supplied paths BEFORE taking the write lock. Normal
  // callers pass dialog / drag-drop paths or our own temp downloads, but this
  // is a trust boundary — reject anything that isn't an absolute
  // .zip/.rar/.7z/.pak so a compromised renderer can't copy/extract arbitrary
  // files into the game.
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error('No files provided to install')
  }
  for (const fp of filePaths) {
    if (typeof fp !== 'string' || !path.isAbsolute(fp)) {
      throw new Error(`Invalid file path: ${String(fp)}`)
    }
    const ext = path.extname(fp).toLowerCase()
    if (ext !== '.zip' && ext !== '.rar' && ext !== '.7z' && ext !== '.pak') {
      throw new Error(`Unsupported file type: ${path.basename(fp)}`)
    }
  }
  // Serialize the on-disk write phase across ALL install paths (mods:install,
  // Nexus install-mod/install-file, URL install) and with toggle/remove, which
  // share this chain. Downloads run before this call, so they never hold the lock.
  // Every entry was checked to be an absolute archive / pak path above.
  return serializeModWrite(() => installModsLocked(filePaths as string[], mainWindow))
}

async function installModsLocked(filePaths: string[], mainWindow: MainWindow): Promise<InstalledArchive[]> {
  const gamePath = configStore.get('gamePath')
  if (!gamePath) throw new Error('Game path not set')

  // null only when the game folder itself is gone — the fs calls below then
  // throw, as they always did.
  const paksPath = getPaksPath(gamePath) as string
  const installed: InstalledArchive[] = []
  let thrown: InstallError | null = null

  try {
  for (const filePath of filePaths) {
    const ext = path.extname(filePath).toLowerCase()

    if (ext === '.pak') {
      const name = path.basename(filePath).replace(/\.(pak|pak\.disabled)$/i, '').replace(/_P$/, '')
      const pakMods = [{ name, modType: 'PAK' as const }]
      await withRollback(gamePath, pakMods, () => {
        copyFile(filePath, paksPath)
      })
      // `mods` carries the actual landed identifiers so Nexus tracking can
      // reconcile its install list against what's currently on disk (lets
      // the "已安裝" badge auto-clear when the user removes the mod).
      installed.push({ name: path.basename(filePath), type: 'pak-only', mods: pakMods })
      logger.info(`Mod installed: ${path.basename(filePath)} (type: pak-only)`)
    } else if (ext === '.zip' || ext === '.rar' || ext === '.7z') {
      // The extension is advisory only: Nexus's newer CDN serves GUID URLs
      // with no extension and the download flow names those .zip regardless
      // of content, so a RAR/7z payload can arrive as "mod.zip". Pick the
      // extractor from the file's magic bytes and fail with a clear message
      // when the content isn't a recognizable archive at all.
      const format = detectArchiveFormat(filePath)
      const extractors: Partial<Record<string, typeof extractZip>> = { zip: extractZip, rar: extractRar, '7z': extract7z }
      const extractFn = extractors[format]
      if (!extractFn) {
        throw new Error(`${path.basename(filePath)} is not a valid zip/rar/7z archive — the download may be corrupted or in an unsupported format`)
      }

      const analysis = await extractFn(filePath, null, true)
      const { type, hasGameStructure, gameStructurePrefix } = analysis
      // Everything except pak-only and the UE4SS temp-copy branches extracts
      // into the game root, which only replaces some of the analysed mods.
      const extractsToRoot = type === 'game-structure' || type === 'complex' || !!hasGameStructure
      const targetMods = extractsToRoot ? modsReplacedByRootExtract(gamePath, analysis) : (analysis.mods || [])

      await withRollback(gamePath, targetMods, async () => {
        if (type === 'pak-only') {
          await extractFn(filePath, paksPath)
        } else if (type === 'hybrid') {
          let ue4ssModsPath = getUe4ssModsPath(gamePath)
          let linkMods: readonly ModRef[] = targetMods
          let pakNames = analysis.pakFiles.map(p => path.basename(p))

          if (hasGameStructure) {
            // Extracted in place, so a bundle that brings UE4SS itself needs no
            // Mods folder up front: look it up, and what landed in it, afterwards.
            // The link names only paks that landed in the Paks tree: toggle /
            // remove act on every listed name, so a pak left out of the game
            // (say a wrapper's optional/ folder) could hit an unrelated live one.
            await extractToGameRoot(extractFn, filePath, gamePath, gameStructurePrefix)
            ue4ssModsPath = getUe4ssModsPath(gamePath)
            linkMods = modsReplacedByRootExtract(gamePath, analysis)
            pakNames = [...new Set(rootExtractPaks(gamePath, analysis).map(fp => path.basename(fp)))]
          } else {
            if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found. Please install UE4SS first.')
            const tempDir = path.join(gamePath, '_hzmm_hybrid_temp')
            try {
              // Stale leftovers from a previous crashed install would otherwise
              // get walked into the game alongside the new mod's files.
              fs.rmSync(tempDir, { recursive: true, force: true })
              await extractFn(filePath, tempDir)
              const walkFiles = (dir: string): string[] => {
                const results: string[] = []
                for (const entry of fs.readdirSync(dir)) {
                  const full = path.join(dir, entry)
                  if (fs.statSync(full).isDirectory()) results.push(...walkFiles(full))
                  else results.push(full)
                }
                return results
              }
              for (const f of walkFiles(tempDir)) {
                if (PAK_FILE_RE.test(f)) {
                  fs.copyFileSync(f, path.join(paksPath, path.basename(f)))
                }
              }
              // No UE4SS folder found means nothing of it was rotated either;
              // the paks above still make a working install.
              if (copyUe4ssModDirs(tempDir, analysis.ue4ssModDirs, ue4ssModsPath) === 0) {
                logger.warn(`No UE4SS mod folder found in hybrid archive ${path.basename(filePath)}`)
              }
            } finally {
              fs.rmSync(tempDir, { recursive: true, force: true })
            }
          }

          // Walk the installed mods (covers lua and cppmod folders) so cppmod-only
          // hybrid packs also get the link written, letting remove/toggle on
          // the UE4SS side carry the paired PAK along.
          for (const mod of linkMods) {
            if (mod.modType !== 'UE4SS' || !ue4ssModsPath) continue
            const destDir = path.join(ue4ssModsPath, mod.name)
            if (fs.existsSync(destDir)) {
              fs.writeFileSync(path.join(destDir, '_hzmm_link.json'), JSON.stringify({ pakFiles: pakNames }), 'utf-8')
              logger.info(`Hybrid link saved: ${mod.name} ↔ ${pakNames.join(', ')}`)
            }
          }
        } else if (type === 'ue4ss-mod' && !hasGameStructure) {
          const ue4ssModsPath = getUe4ssModsPath(gamePath)
          if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found. Please install UE4SS first.')

          const tempDir = path.join(gamePath, '_hzmm_ue4ss_temp')
          try {
            // Stale leftovers from a previous crashed install would otherwise
            // get copied into the UE4SS Mods folder alongside the new mod.
            fs.rmSync(tempDir, { recursive: true, force: true })
            await extractFn(filePath, tempDir)
            // Nothing copied would otherwise be reported as a successful install.
            if (copyUe4ssModDirs(tempDir, analysis.ue4ssModDirs, ue4ssModsPath) === 0) {
              throw new Error('No UE4SS mod folder found in archive')
            }
          } finally {
            fs.rmSync(tempDir, { recursive: true, force: true })
          }
        } else {
          // game-structure / ue4ss-mod with game structure / complex → 解壓到遊戲根目錄
          await extractToGameRoot(extractFn, filePath, gamePath, gameStructurePrefix)
        }
      })

      // The mods this install placed. Re-resolved after a root extract: a
      // bundle may have just created the UE4SS Mods folder.
      const placedMods = extractsToRoot ? modsReplacedByRootExtract(gamePath, analysis) : targetMods

      // Extract readme from archive and save it for the placed mods (a live
      // mod a root extract left alone keeps its own readme)
      if (analysis.readmeFiles && analysis.readmeFiles.length > 0 && placedMods.length > 0) {
        try {
          const readmesDir = path.join(configStore.getConfigDir(), 'readmes')
          fs.mkdirSync(readmesDir, { recursive: true })
          const normalizedReadme = analysis.readmeFiles[0]
          if (format === 'zip') {
            // Only the head is kept (normalizeReadme truncates), so never
            // inflate more than that: UTF-8 needs at most 4 bytes per unit, plus a BOM.
            const buf = await readZipEntryHead(filePath, normalizedReadme, MAX_README_CHARS * 4 + 3)
            if (buf) {
              const content = normalizeReadme(buf)
              for (const mod of placedMods) {
                fs.writeFileSync(path.join(readmesDir, `${mod.name}.txt`), content, 'utf-8')
                logger.info(`Readme saved for mod: ${mod.name}`)
              }
            }
          } else {
            logger.info(`Readme found in ${format} but extraction not yet supported`)
          }
        } catch (err) { logger.warn(`Failed to extract readme: ${(err as Error).message}`) }
      }

      // Sync mods.txt / mods.json for installed UE4SS mods — only the ones this
      // install placed, and only if their folder exists, so the registry never
      // gains enabled entries for folders that aren't there.
      const ue4ssModsPath = getUe4ssModsPath(gamePath)
      if (ue4ssModsPath) {
        for (const mod of placedMods) {
          if (mod.modType === 'UE4SS' && fs.existsSync(path.join(ue4ssModsPath, mod.name))) {
            syncUe4ssModRegistry(ue4ssModsPath, mod.name, true)
          }
        }
      }

      // `mods` echoes the archive analysis so downstream consumers (e.g.
      // Nexus tracking) know which local mod names actually landed, which
      // lets them later cross-check against scanMods() to auto-clear the
      // install badge when the user removes a mod via the Modules tab.
      installed.push({ name: path.basename(filePath), type, mods: analysis.mods || [] })
      logger.info(`Mod installed: ${path.basename(filePath)} (type: ${type})`)
    }
  }
  } catch (err) {
    thrown = err as InstallError
  } finally {
    // Always refresh cache + notify renderer, even on partial failure,
    // so the UI reflects what actually landed on disk.
    invalidateCache()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mods:updated')
    }
  }

  if (thrown) {
    // Attach partial success info so caller can surface "X of Y installed"
    thrown.installed = installed
    throw thrown
  }

  return installed
}

export { installMods, copyDirSync, withRollback, serializeModWrite, cleanupStaleRollback }
