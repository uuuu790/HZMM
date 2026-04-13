import { ipcMain, app } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import { getPaksPath, getAllPaksPaths, getUe4ssModsPath } from '../services/steam-detector.js'
import { extractZip, extractRar, copyFile, downloadFile, analyzeArchiveStructure } from '../services/archive.js'
import { resolveWithin, assertSafeSegment } from '../services/path-safety.js'
import logger from '../services/logger.js'
import { BUILTIN_MODS, CONFIG_EXTENSIONS } from './constants.js'

// Allowed hosts for mod downloads. Exact-match only — no wildcard subdomains.
// Previously a bare 'nexusmods.com' entry + endsWith check let ANY nexusmods
// subdomain through, including retired/forum ones that could be hijacked.
// The CDN list below covers every host the Nexus API actually resolves to.
export const ALLOWED_MOD_HOSTS = Object.freeze([
  'github.com',
  'objects.githubusercontent.com',
  'cf-files.nexusmods.com',
  'amsterdam.nexusmods.com',
  'chicago.nexusmods.com',
  'la.nexusmods.com',
  'london.nexusmods.com',
  'miami.nexusmods.com',
  'paris.nexusmods.com',
  'prague.nexusmods.com',
  'singapore.nexusmods.com',
])

const ALLOWED_MOD_HOST_SET = new Set(ALLOWED_MOD_HOSTS)

export function isAllowedModUrl(urlStr) {
  if (typeof urlStr !== 'string' || !urlStr) return false
  let parsed
  try {
    parsed = new URL(urlStr)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  return ALLOWED_MOD_HOST_SET.has(parsed.hostname)
}

// Resolve a UE4SS mod config file path from renderer-supplied inputs.
// Blocks traversal in BOTH modFilename and relativePath — neither may escape
// the mods root. Throws on any escape attempt or invalid input.
export function resolveModConfigPath(ue4ssModsPath, modFilename, relativePath) {
  if (typeof ue4ssModsPath !== 'string' || !ue4ssModsPath) {
    throw new Error('Invalid mods root')
  }
  if (typeof modFilename !== 'string' || !modFilename) {
    throw new Error('Invalid mod filename')
  }
  if (typeof relativePath !== 'string' || !relativePath) {
    throw new Error('Invalid relative path')
  }
  return resolveWithin(ue4ssModsPath, modFilename, relativePath)
}

// --- Mod scan cache ---
let modCache = {
  pakDirMtimes: {},
  ue4ssDirMtime: null,
  mods: [],
  valid: false
}

// Install / scan mutex: mods:install, mods:remove, mods:toggle, and
// mods:scan all touch the same directories and the mod cache. Concurrent
// invocations (rapid user clicks, background rescans) could previously
// interleave, leaving the cache inconsistent with disk. This promise
// chain serializes all write-side IPC calls.
let modWriteChain = Promise.resolve()
function serializeModWrite(task) {
  const next = modWriteChain.then(() => task())
  // Swallow rejections on the chain itself — each caller still gets
  // its own rejected promise via the return value.
  modWriteChain = next.catch(() => {})
  return next
}

function getDirMtime(dirPath) {
  try {
    return fs.statSync(dirPath).mtimeMs
  } catch {
    return null
  }
}

function isCacheValid() {
  if (!modCache.valid) return false

  const gamePath = configStore.get('gamePath')
  if (!gamePath) return false

  const paksPaths = getAllPaksPaths(gamePath)
  for (const p of paksPaths) {
    const current = getDirMtime(p)
    if (current !== modCache.pakDirMtimes[p]) return false
  }

  const ue4ssModsPath = getUe4ssModsPath(gamePath)
  if (ue4ssModsPath) {
    const current = getDirMtime(ue4ssModsPath)
    if (current !== modCache.ue4ssDirMtime) return false
  }

  return true
}

function updateCacheState(mods) {
  const gamePath = configStore.get('gamePath')
  if (!gamePath) return

  const paksPaths = getAllPaksPaths(gamePath)
  const pakDirMtimes = {}
  for (const p of paksPaths) {
    pakDirMtimes[p] = getDirMtime(p)
  }

  const ue4ssModsPath = getUe4ssModsPath(gamePath)

  modCache = {
    pakDirMtimes,
    ue4ssDirMtime: ue4ssModsPath ? getDirMtime(ue4ssModsPath) : null,
    mods,
    valid: true
  }
}

function invalidateCache() {
  modCache.valid = false
}

function scanMods() {
  const gamePath = configStore.get('gamePath')
  if (!gamePath) return []

  const mods = []
  const seenPakIds = new Set()

  // --- 先掃描 UE4SS Lua mods（收集 hybrid 連結）---
  const hybridPakMap = new Map() // pakBaseName → ue4ss mod folder name
  const ue4ssModsPath = getUe4ssModsPath(gamePath)
  if (ue4ssModsPath && fs.existsSync(ue4ssModsPath)) {
    const dirs = fs.readdirSync(ue4ssModsPath)

    for (const dir of dirs) {
      if (BUILTIN_MODS.has(dir) || dir.startsWith('.')) continue

      const modDir = path.join(ue4ssModsPath, dir)
      const stat = fs.statSync(modDir)
      if (!stat.isDirectory()) continue

      const hasScripts = fs.existsSync(path.join(modDir, 'Scripts', 'main.lua'))
      const hasMainLua = fs.existsSync(path.join(modDir, 'main.lua'))
      const hasDlls = fs.readdirSync(modDir).some(f => f.endsWith('.dll'))
      if (!hasScripts && !hasMainLua && !hasDlls) continue

      const enabledFile = path.join(modDir, 'enabled.txt')
      const ue4ssEnabled = fs.existsSync(enabledFile)

      // 檢查 hybrid 連結
      const linkFile = path.join(modDir, '_hzmm_link.json')
      let linkedPaks = null
      if (fs.existsSync(linkFile)) {
        try {
          linkedPaks = JSON.parse(fs.readFileSync(linkFile, 'utf-8')).pakFiles || []
          linkedPaks.forEach(p => hybridPakMap.set(p.replace('.disabled', ''), dir))
        } catch { linkedPaks = null }
      }

      const isHybrid = linkedPaks && linkedPaks.length > 0
      mods.push({
        id: `ue4ss:${dir}`,
        filename: dir,
        title: dir.replace(/_/g, ' ').replace(/-/g, ' '),
        enabled: ue4ssEnabled,
        size: 0,
        modified: stat.mtime.toISOString(),
        type: 'UE4SS',
        hybrid: isHybrid,
        linkedPaks: isHybrid ? linkedPaks : undefined,
        path: modDir
      })
    }
  }

  // --- 掃描 PAK mods（hybrid 標記但不隱藏）---
  const paksPaths = getAllPaksPaths(gamePath)
  for (const paksPath of paksPaths) {
    try {
      const files = fs.readdirSync(paksPath)

      for (const file of files) {
        const filePath = path.join(paksPath, file)
        const stat = fs.statSync(filePath)
        if (!stat.isFile()) continue

        const isPak = file.endsWith('.pak')
        const isDisabled = file.endsWith('.pak.disabled')

        const baseLower = file.toLowerCase()
        if (baseLower.startsWith('pakchunk') || baseLower.startsWith('global')) continue

        if (isPak || isDisabled) {
          const baseName = file.replace('.disabled', '')
          if (seenPakIds.has(baseName)) continue
          seenPakIds.add(baseName)
          const linkedUe4ss = hybridPakMap.get(baseName) || null

          mods.push({
            id: baseName,
            filename: file,
            title: baseName.replace('.pak', '').replace(/_P$/, '').replace(/_/g, ' ').replace(/-/g, ' '),
            enabled: isPak,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            type: 'PAK',
            hybrid: !!linkedUe4ss,
            linkedUe4ss: linkedUe4ss || undefined,
            path: filePath
          })
        }
      }
    } catch (err) {
      logger.warn(`Failed to scan PAK directory ${paksPath}: ${err.message}`)
    }
  }

  return mods
}

// Remove existing mod files before reinstall to avoid leftover artifacts
function cleanExistingMod(gamePath, mods) {
  const paksPath = getPaksPath(gamePath)
  const allPaksPaths = getAllPaksPaths(gamePath)
  const ue4ssModsPath = getUe4ssModsPath(gamePath)

  for (const mod of mods) {
    if (mod.modType === 'PAK') {
      // Remove existing PAK (enabled or disabled) from all paks paths
      const pakName = mod.name + '_P.pak'
      for (const pp of allPaksPaths) {
        for (const suffix of ['', '.disabled']) {
          const fp = path.join(pp, pakName + suffix)
          if (fs.existsSync(fp)) {
            fs.unlinkSync(fp)
            logger.info(`Pre-install cleanup: removed ${pakName}${suffix}`)
          }
        }
      }
      // Remove saved readme
      const readmePath = path.join(configStore.getConfigDir(), 'readmes', `${mod.name}.txt`)
      if (fs.existsSync(readmePath)) { try { fs.unlinkSync(readmePath) } catch {} }
    } else if (mod.modType === 'UE4SS' && ue4ssModsPath) {
      const modDir = path.join(ue4ssModsPath, mod.name)
      if (fs.existsSync(modDir)) {
        fs.rmSync(modDir, { recursive: true, force: true })
        logger.info(`Pre-install cleanup: removed UE4SS folder ${mod.name}`)
      }
    }
  }
}

async function installMods(filePaths, mainWindow) {
  const gamePath = configStore.get('gamePath')
  if (!gamePath) throw new Error('Game path not set')

  const paksPath = getPaksPath(gamePath)
  const installed = []

  for (const filePath of filePaths) {
    const ext = path.extname(filePath).toLowerCase()

    if (ext === '.pak') {
      // Clean existing before install
      const name = path.basename(filePath).replace(/\.(pak|pak\.disabled)$/i, '').replace(/_P$/, '')
      cleanExistingMod(gamePath, [{ name, modType: 'PAK' }])
      copyFile(filePath, paksPath)
      installed.push({ name: path.basename(filePath), type: 'pak-only' })
      logger.info(`Mod installed: ${path.basename(filePath)} (type: pak-only)`)
    } else if (ext === '.zip' || ext === '.rar') {
      const extractFn = ext === '.zip' ? extractZip : extractRar

      const analysis = await extractFn(filePath, null, true)
      const { type, hasGameStructure } = analysis

      // Clean existing mods before install
      if (analysis.mods && analysis.mods.length > 0) {
        cleanExistingMod(gamePath, analysis.mods)
      }

      if (type === 'pak-only') {
        await extractFn(filePath, paksPath)
      } else if (type === 'hybrid') {
        // 混合型：PAK 和 UE4SS 分開處理，存連結檔做配套
        const ue4ssModsPath = getUe4ssModsPath(gamePath)
        if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found. Please install UE4SS first.')
        const pakNames = analysis.pakFiles.map(p => path.basename(p))

        if (hasGameStructure) {
          await extractFn(filePath, gamePath)
        } else {
          const tempDir = path.join(gamePath, '_hzmm_hybrid_temp')
          try {
            await extractFn(filePath, tempDir)
            const walkFiles = (dir) => {
              const results = []
              for (const entry of fs.readdirSync(dir)) {
                const full = path.join(dir, entry)
                if (fs.statSync(full).isDirectory()) results.push(...walkFiles(full))
                else results.push(full)
              }
              return results
            }
            for (const f of walkFiles(tempDir)) {
              if (f.endsWith('.pak') || f.endsWith('.ucas') || f.endsWith('.utoc')) {
                fs.copyFileSync(f, path.join(paksPath, path.basename(f)))
              }
            }
            // Only copy UE4SS mod folders (those containing Scripts/main.lua or main.lua or dlls)
            const findUe4ssFolders = (dir) => {
              const results = []
              for (const entry of fs.readdirSync(dir)) {
                const full = path.join(dir, entry)
                if (!fs.statSync(full).isDirectory()) continue
                const hasScripts = fs.existsSync(path.join(full, 'Scripts', 'main.lua'))
                const hasMain = fs.existsSync(path.join(full, 'main.lua'))
                const hasDll = fs.readdirSync(full).some(f => f.endsWith('.dll'))
                if (hasScripts || hasMain || hasDll) {
                  results.push({ name: entry, path: full })
                } else {
                  // Recurse into subdirectories (zip may have a wrapper folder)
                  results.push(...findUe4ssFolders(full))
                }
              }
              return results
            }
            for (const folder of findUe4ssFolders(tempDir)) {
              copyDirSync(folder.path, path.join(ue4ssModsPath, folder.name))
            }
          } finally {
            fs.rmSync(tempDir, { recursive: true, force: true })
          }
        }

        // 存連結檔到每個 UE4SS mod 資料夾
        const ue4ssFolders = new Set()
        for (const luaFile of (analysis.luaFiles || [])) {
          const parts = luaFile.replace(/\\/g, '/').split('/')
          const idx = parts.findIndex(p => p.toLowerCase() === 'scripts')
          if (idx > 0) ue4ssFolders.add(parts[idx - 1])
        }
        for (const folder of ue4ssFolders) {
          const destDir = path.join(ue4ssModsPath, folder)
          if (fs.existsSync(destDir)) {
            fs.writeFileSync(path.join(destDir, '_hzmm_link.json'), JSON.stringify({ pakFiles: pakNames }), 'utf-8')
            logger.info(`Hybrid link saved: ${folder} ↔ ${pakNames.join(', ')}`)
          }
        }
      } else if (type === 'ue4ss-mod' && !hasGameStructure) {
        // UE4SS mod（無遊戲目錄結構）→ 解壓到 UE4SS Mods 資料夾
        const ue4ssModsPath = getUe4ssModsPath(gamePath)
        if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found. Please install UE4SS first.')

        // Check if zip has a wrapper folder like "Mods/" that would cause double nesting
        // Extract to temp first, then copy only UE4SS mod folders
        const tempDir = path.join(gamePath, '_hzmm_ue4ss_temp')
        try {
          await extractFn(filePath, tempDir)
          const findUe4ssFolders = (dir) => {
            const results = []
            for (const entry of fs.readdirSync(dir)) {
              const full = path.join(dir, entry)
              if (!fs.statSync(full).isDirectory()) continue
              const hasScripts = fs.existsSync(path.join(full, 'Scripts', 'main.lua'))
              const hasMain = fs.existsSync(path.join(full, 'main.lua'))
              const hasDll = fs.readdirSync(full).some(f => f.endsWith('.dll'))
              if (hasScripts || hasMain || hasDll) {
                results.push({ name: entry, path: full })
              } else {
                results.push(...findUe4ssFolders(full))
              }
            }
            return results
          }
          const folders = findUe4ssFolders(tempDir)
          for (const folder of folders) {
            copyDirSync(folder.path, path.join(ue4ssModsPath, folder.name))
          }
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      } else {
        // game-structure / ue4ss-mod with game structure / complex → 解壓到遊戲根目錄
        await extractFn(filePath, gamePath)
      }

      // Extract readme from archive and save for PAK mods (UE4SS mods already have it in their folder)
      if (analysis.readmeFiles && analysis.readmeFiles.length > 0 && analysis.mods) {
        try {
          const readmesDir = path.join(configStore.getConfigDir(), 'readmes')
          fs.mkdirSync(readmesDir, { recursive: true })
          const normalizedReadme = analysis.readmeFiles[0]
          if (ext === '.zip') {
            const StreamZip = (await import('node-stream-zip')).default
            const zip = new StreamZip.async({ file: filePath, skipEntryNameValidation: true })
            try {
              // Find the original entry name (may have backslashes) matching our normalized path
              const entries = await zip.entries()
              const match = Object.values(entries).find(e => e.name.replace(/\\/g, '/') === normalizedReadme)
              if (match) {
                const buf = await zip.entryData(match)
                const content = buf.toString('utf-8').slice(0, 5000)
                for (const mod of analysis.mods) {
                  fs.writeFileSync(path.join(readmesDir, `${mod.name}.txt`), content, 'utf-8')
                  logger.info(`Readme saved for mod: ${mod.name}`)
                }
              }
            } finally { await zip.close() }
          } else {
            // RAR: readme was extracted to temp during install, read from there
            // For now just log — rar readme support can be added later
            logger.info(`Readme found in rar but extraction not yet supported`)
          }
        } catch (err) { logger.warn(`Failed to extract readme: ${err.message}`) }
      }

      installed.push({ name: path.basename(filePath), type })
      logger.info(`Mod installed: ${path.basename(filePath)} (type: ${type})`)
    }
  }

  invalidateCache()

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mods:updated')
  }

  return installed
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src)
  for (const entry of entries) {
    const srcPath = path.join(src, entry)
    const destPath = path.join(dest, entry)
    const stat = fs.statSync(srcPath)
    if (stat.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// Shared: recursively scan a directory for config files
function scanConfigDir(dir, relativeBase, configExts, excludeFiles, collector) {
  const entries = fs.readdirSync(dir)
  for (const entry of entries) {
    const fullPath = path.join(dir, entry)
    const relativePath = relativeBase ? path.join(relativeBase, entry) : entry
    const stat = fs.statSync(fullPath)
    if (stat.isDirectory()) {
      scanConfigDir(fullPath, relativePath, configExts, excludeFiles, collector)
    } else if (stat.isFile()) {
      const ext = path.extname(entry).toLowerCase()
      if (configExts.has(ext) && !excludeFiles.has(entry.toLowerCase())) {
        // .lua / .txt 只抓檔名含 "config" 的
        if ((ext === '.lua' || ext === '.txt') && !entry.toLowerCase().includes('config')) continue
        collector(relativePath.replace(/\\/g, '/'), fullPath, stat)
      }
    }
  }
}

function registerModsIpc(mainWindow) {
  ipcMain.handle('mods:scan', () => {
    if (isCacheValid()) {
      return modCache.mods
    }
    const mods = scanMods()
    updateCacheState(mods)
    return mods
  })

  ipcMain.handle('mods:invalidate-cache', () => {
    invalidateCache()
  })

  ipcMain.handle('mods:toggle', (_, filename) => {
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
      const isEnabled = fs.existsSync(enabledFile)

      if (isEnabled) {
        fs.unlinkSync(enabledFile)
      } else {
        fs.writeFileSync(enabledFile, '', 'utf-8')
      }

      // Hybrid 連動：一起切換關聯的 PAK
      const linkFile = path.join(modDir, '_hzmm_link.json')
      if (fs.existsSync(linkFile)) {
        try {
          const { pakFiles: linkedPaks } = JSON.parse(fs.readFileSync(linkFile, 'utf-8'))
          const allPaksPaths = getAllPaksPaths(gamePath)
          for (const pakName of (linkedPaks || [])) {
            const baseName = pakName.replace('.disabled', '')
            for (const pp of allPaksPaths) {
              const enabledPath = path.join(pp, baseName)
              const disabledPath = path.join(pp, baseName + '.disabled')
              if (isEnabled && fs.existsSync(enabledPath)) {
                // 要禁用 → .pak → .pak.disabled
                fs.renameSync(enabledPath, disabledPath)
                logger.info(`Hybrid PAK toggled: ${baseName} → disabled`)
              } else if (!isEnabled && fs.existsSync(disabledPath)) {
                // 要啟用 → .pak.disabled → .pak
                fs.renameSync(disabledPath, enabledPath)
                logger.info(`Hybrid PAK toggled: ${baseName} → enabled`)
              }
            }
          }
        } catch (err) {
          logger.warn(`Failed to toggle hybrid PAK: ${err.message}`)
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

    // Bug 4+5 fix: PAK mod toggle — search across ALL paks paths
    const paksPaths = getAllPaksPaths(gamePath)
    let filePath = null
    for (const paksPath of paksPaths) {
      const candidate = path.join(paksPath, filename)
      if (fs.existsSync(candidate)) {
        filePath = candidate
        break
      }
    }

    if (!filePath) throw new Error(`File not found: ${filename}`)

    let newPath
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
        for (const dir of fs.readdirSync(ue4ssModsPath2)) {
          const linkFile = path.join(ue4ssModsPath2, dir, '_hzmm_link.json')
          if (!fs.existsSync(linkFile)) continue
          const { pakFiles } = JSON.parse(fs.readFileSync(linkFile, 'utf-8'))
          if (!(pakFiles || []).some(p => p.replace('.disabled', '') === baseName)) continue
          const enabledFile = path.join(ue4ssModsPath2, dir, 'enabled.txt')
          if (pakNowEnabled && !fs.existsSync(enabledFile)) {
            fs.writeFileSync(enabledFile, '', 'utf-8')
            logger.info(`Hybrid UE4SS toggled: ${dir} → enabled`)
          } else if (!pakNowEnabled && fs.existsSync(enabledFile)) {
            fs.unlinkSync(enabledFile)
            logger.info(`Hybrid UE4SS toggled: ${dir} → disabled`)
          }
          break
        }
      } catch (err) {
        logger.warn(`Failed to toggle hybrid UE4SS: ${err.message}`)
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
  })

  ipcMain.handle('mods:install', (_, filePaths) =>
    serializeModWrite(() => installMods(filePaths, mainWindow))
  )

  // --- Config 檔案管理 ---

  ipcMain.handle('mods:get-config-files', (_, modFilename) => {
    assertSafeSegment('modFilename', modFilename)
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return []

    const isPakMod = modFilename.endsWith('.pak') || modFilename.endsWith('.pak.disabled')
    if (isPakMod) return [] // PAK mod 沒有 config 檔

    // UE4SS mod — 掃描資料夾內的 config 檔案
    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) return []

    const modDir = path.join(ue4ssModsPath, modFilename)
    if (!fs.existsSync(modDir)) return []

    const configExts = new Set(CONFIG_EXTENSIONS)
    const excludeFiles = new Set(['enabled.txt', '_hzmm_link.json'])
    const results = []

    scanConfigDir(modDir, '', configExts, excludeFiles, (relPath, fullPath, stat) => {
      results.push({ name: path.basename(fullPath), relativePath: relPath, size: stat.size })
    })
    return results
  })

  ipcMain.handle('mods:read-config', (_, modFilename, relativePath) => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')

    const resolved = resolveModConfigPath(ue4ssModsPath, modFilename, relativePath)

    if (!fs.existsSync(resolved)) throw new Error('File not found')
    return fs.readFileSync(resolved, 'utf-8')
  })

  ipcMain.handle('mods:save-config', (_, modFilename, relativePath, content) => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')

    const resolved = resolveModConfigPath(ue4ssModsPath, modFilename, relativePath)

    fs.writeFileSync(resolved, content, 'utf-8')
    return true
  })

  // --- 配置檔 Config 快照/還原 ---

  ipcMain.handle('profiles:snapshot-configs', () => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return {}

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) return {}

    const configExts = new Set(CONFIG_EXTENSIONS)
    const excludeFiles = new Set(['enabled.txt', '_hzmm_link.json'])
    const snapshot = {}

    const dirs = fs.readdirSync(ue4ssModsPath)
    for (const dir of dirs) {
      if (BUILTIN_MODS.has(dir)) continue
      const modDir = path.join(ue4ssModsPath, dir)
      if (!fs.statSync(modDir).isDirectory()) continue

      const modConfigs = {}

      scanConfigDir(modDir, '', configExts, excludeFiles, (relPath, fullPath) => {
        try {
          modConfigs[relPath] = fs.readFileSync(fullPath, 'utf-8')
        } catch {
          // 讀不到就跳過
        }
      })
      if (Object.keys(modConfigs).length > 0) {
        snapshot[dir] = modConfigs
      }
    }

    return snapshot
  })

  ipcMain.handle('profiles:restore-configs', (_, configSnapshot) => {
    if (!configSnapshot || typeof configSnapshot !== 'object') return false

    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')

    for (const [modName, configs] of Object.entries(configSnapshot)) {
      if (typeof modName !== 'string' || !modName) continue
      const modDir = path.join(ue4ssModsPath, modName)
      if (!fs.existsSync(modDir)) continue

      for (const [relativePath, content] of Object.entries(configs)) {
        let resolved
        try {
          resolved = resolveModConfigPath(ue4ssModsPath, modName, relativePath)
        } catch (err) {
          logger.warn(`Skipping traversal attempt in profile restore: ${modName}/${relativePath} — ${err.message}`)
          continue
        }

        const dir = path.dirname(resolved)
        fs.mkdirSync(dir, { recursive: true })

        fs.writeFileSync(resolved, content, 'utf-8')
      }
    }

    invalidateCache()
    return true
  })

  ipcMain.handle('mods:remove', (_, filename) => {
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
          const allPaksPaths = getAllPaksPaths(gamePath)
          for (const pakName of (linkedPaks || [])) {
            const baseName = pakName.replace('.disabled', '')
            for (const pp of allPaksPaths) {
              const ep = path.join(pp, baseName)
              const dp = path.join(pp, baseName + '.disabled')
              if (fs.existsSync(ep)) { fs.unlinkSync(ep); logger.info(`Hybrid PAK removed: ${baseName}`); break }
              if (fs.existsSync(dp)) { fs.unlinkSync(dp); logger.info(`Hybrid PAK removed: ${baseName}.disabled`); break }
            }
          }
        } catch (err) { logger.warn(`Failed to remove hybrid PAK: ${err.message}`) }
      }

      if (fs.existsSync(modDir)) {
        fs.rmSync(modDir, { recursive: true, force: true })
      }
      invalidateCache()
      logger.info(`Mod removed: ${filename}`)
      return true
    }

    // Bug 5 fix: PAK mod removal — search across ALL paks paths
    const paksPaths = getAllPaksPaths(gamePath)
    let found = false
    for (const paksPath of paksPaths) {
      const filePath = path.join(paksPath, filename)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        found = true
        break
      }
    }

    if (!found) throw new Error(`PAK file not found: ${filename}`)

    // Clean up saved readme for PAK mod
    const modName = filename.replace(/\.(pak|pak\.disabled)$/i, '').replace(/_P$/, '')
    const readmePath = path.join(configStore.getConfigDir(), 'readmes', `${modName}.txt`)
    if (fs.existsSync(readmePath)) { try { fs.unlinkSync(readmePath) } catch {} }

    // Hybrid 反向連動：刪 PAK 時也刪關聯的 UE4SS
    const ue4ssModsPath2 = getUe4ssModsPath(gamePath)
    if (ue4ssModsPath2) {
      const baseName = filename.replace('.disabled', '')
      try {
        for (const dir of fs.readdirSync(ue4ssModsPath2)) {
          const linkFile = path.join(ue4ssModsPath2, dir, '_hzmm_link.json')
          if (!fs.existsSync(linkFile)) continue
          const { pakFiles } = JSON.parse(fs.readFileSync(linkFile, 'utf-8'))
          if (!(pakFiles || []).some(p => p.replace('.disabled', '') === baseName)) continue
          fs.rmSync(path.join(ue4ssModsPath2, dir), { recursive: true, force: true })
          logger.info(`Hybrid UE4SS removed: ${dir}`)
          break
        }
      } catch (err) { logger.warn(`Failed to remove hybrid UE4SS: ${err.message}`) }
    }

    invalidateCache()
    logger.info(`Mod removed: ${filename}`)
    return true
  })

  // --- Install Preview ---
  ipcMain.handle('mods:preview', async (_, filePaths) => {
    const results = []
    for (const filePath of filePaths) {
      const ext = path.extname(filePath).toLowerCase()
      try {
        if (ext === '.pak') {
          const name = path.basename(filePath).replace(/\.(pak|pak\.disabled)$/i, '').replace(/_P$/, '')
          results.push({ filePath, fileName: path.basename(filePath), type: 'pak-only', mods: [{ name, modType: 'PAK' }], totalFiles: 1 })
        } else if (ext === '.zip') {
          const analysis = await extractZip(filePath, null, true)
          results.push({ filePath, fileName: path.basename(filePath), type: analysis.type, mods: analysis.mods || [], totalFiles: (analysis.entryNames || []).filter(n => !n.endsWith('/')).length })
        } else if (ext === '.rar') {
          const analysis = await extractRar(filePath, null, true)
          results.push({ filePath, fileName: path.basename(filePath), type: analysis.type, mods: analysis.mods || [], totalFiles: 0 })
        }
      } catch (err) {
        // Keep batch semantics (don't fail the whole preview on one bad file)
        // but use error-level logging so corrupt archives are loud in the log.
        logger.error(`Preview failed for ${filePath}: ${err.message}`)
        results.push({ filePath, fileName: path.basename(filePath), type: 'unknown', entries: [], totalFiles: 0, error: err.message })
      }
    }
    return results
  })

  // --- Mod Readme ---
  ipcMain.handle('mods:get-readme', (_, modFilename) => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return null
    const isPakMod = modFilename.endsWith('.pak') || modFilename.endsWith('.pak.disabled')
    const readmeNames = ['README.md', 'readme.md', 'README.txt', 'readme.txt', 'README', 'readme', 'DESCRIPTION.txt', 'description.txt', 'INFO.txt', 'info.txt']

    if (isPakMod) {
      // PAK mod: check saved readmes from install time
      const modName = modFilename.replace(/\.(pak|pak\.disabled)$/i, '').replace(/_P$/, '')
      const readmesDir = path.join(configStore.getConfigDir(), 'readmes')
      const readmePath = path.join(readmesDir, `${modName}.txt`)
      if (fs.existsSync(readmePath)) {
        try { return { filename: 'README.txt', content: fs.readFileSync(readmePath, 'utf-8').slice(0, 5000) } } catch { return null }
      }
      return null
    }

    // UE4SS mod: check readme in mod folder first, then fallback to saved readmes
    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (ue4ssModsPath) {
      const modDir = path.join(ue4ssModsPath, modFilename)
      if (fs.existsSync(modDir)) {
        for (const name of readmeNames) {
          const readmePath = path.join(modDir, name)
          if (fs.existsSync(readmePath)) {
            try { return { filename: name, content: fs.readFileSync(readmePath, 'utf-8').slice(0, 5000) } } catch { /* fall through */ }
          }
        }
      }
    }
    // Fallback: check saved readmes from install time (e.g. readme was in parent folder of zip)
    const savedReadme = path.join(configStore.getConfigDir(), 'readmes', `${modFilename}.txt`)
    if (fs.existsSync(savedReadme)) {
      try { return { filename: 'README.txt', content: fs.readFileSync(savedReadme, 'utf-8').slice(0, 5000) } } catch { return null }
    }
    return null
  })

  // --- Nexus Mods URL parser ---
  function parseNexusUrl(url) {
    // Matches: https://www.nexusmods.com/{game}/mods/{modId}?tab=files&file_id={fileId}
    // or: https://www.nexusmods.com/{game}/mods/{modId}
    const match = url.match(/nexusmods\.com\/([^/]+)\/mods\/(\d+)/)
    if (!match) return null
    const game = match[1]
    const modId = parseInt(match[2])
    const urlObj = new URL(url)
    const fileId = urlObj.searchParams.get('file_id')
    return { game, modId, fileId: fileId ? parseInt(fileId) : null }
  }

  async function nexusApiRequest(endpoint, apiKey) {
    const https = await import('https')
    return new Promise((resolve, reject) => {
      const req = https.default.get(`https://api.nexusmods.com/v1${endpoint}`, {
        headers: { 'apikey': apiKey, 'User-Agent': `HZMM/${app.getVersion()}` }
      }, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          if (res.statusCode === 200) {
            try { resolve(JSON.parse(data)) } catch { reject(new Error('Invalid API response')) }
          } else if (res.statusCode === 401) {
            reject(new Error('Invalid Nexus Mods API key'))
          } else if (res.statusCode === 403) {
            reject(new Error('Nexus Mods API: Premium account required for API downloads'))
          } else {
            reject(new Error(`Nexus API error: HTTP ${res.statusCode}`))
          }
        })
        res.on('error', reject)
      })
      req.on('error', reject)
    })
  }

  async function resolveNexusDownloadUrl(nexusInfo, apiKey) {
    let fileId = nexusInfo.fileId
    // If no file_id, get the latest main file
    if (!fileId) {
      const filesData = await nexusApiRequest(`/games/${nexusInfo.game}/mods/${nexusInfo.modId}/files.json`, apiKey)
      const mainFiles = (filesData.files || []).filter(f => f.category_id === 1) // 1 = Main files
      const allFiles = mainFiles.length > 0 ? mainFiles : (filesData.files || [])
      if (allFiles.length === 0) throw new Error('No files found for this mod')
      // Pick the latest file
      allFiles.sort((a, b) => (b.uploaded_timestamp || 0) - (a.uploaded_timestamp || 0))
      fileId = allFiles[0].file_id
      logger.info(`Nexus: resolved latest file_id=${fileId} for mod ${nexusInfo.modId}`)
    }
    // Get download links
    const links = await nexusApiRequest(`/games/${nexusInfo.game}/mods/${nexusInfo.modId}/files/${fileId}/download_link.json`, apiKey)
    if (!links || links.length === 0) throw new Error('No download links returned from Nexus API')
    return { url: links[0].URI, name: links[0].name || `nexus_mod_${nexusInfo.modId}_${fileId}` }
  }

  // --- Download from URL ---
  ipcMain.handle('mods:download-url', async (_, url) => {
    if (!url || (!url.startsWith('https://') && !url.startsWith('http://'))) throw new Error('Invalid URL')

    // Check if it's a Nexus Mods URL
    const nexusInfo = parseNexusUrl(url)
    if (nexusInfo) {
      const apiKey = configStore.get('nexusApiKey')
      if (!apiKey) throw new Error('NEXUS_API_KEY_REQUIRED')
      logger.info(`Nexus download: game=${nexusInfo.game}, mod=${nexusInfo.modId}, file=${nexusInfo.fileId || 'latest'}`)
      const resolved = await resolveNexusDownloadUrl(nexusInfo, apiKey)
      url = resolved.url
      logger.info(`Nexus resolved download URL: ${url.slice(0, 80)}...`)
    }

    // Validate URL against allowed hosts
    if (!isAllowedModUrl(url)) {
      throw new Error('Download URL is not from an allowed source. Supported: Nexus Mods, GitHub.')
    }

    const urlObj = new URL(url)
    let filename = path.basename(urlObj.pathname)
    if (!filename || !filename.match(/\.(zip|rar|pak)$/i)) filename = `mod_download_${Date.now()}.zip`
    const tempPath = path.join(configStore.getConfigDir(), 'temp', filename)
    fs.mkdirSync(path.dirname(tempPath), { recursive: true })
    try {
      await downloadFile(url, tempPath, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mods:download-progress', progress)
      })
      const result = await installMods([tempPath], mainWindow)
      try { fs.unlinkSync(tempPath) } catch { /* temp file already gone */ }
      return result
    } catch (err) {
      try { fs.unlinkSync(tempPath) } catch { /* temp file already gone */ }
      throw err
    }
  })

}

export { registerModsIpc, scanMods }
