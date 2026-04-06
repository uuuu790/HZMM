import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import { getPaksPath, getAllPaksPaths, getUe4ssModsPath } from '../services/steam-detector.js'
import { extractZip, extractRar, copyFile, downloadFile } from '../services/archive.js'
import logger from '../services/logger.js'

// --- Mod scan cache ---
let modCache = {
  pakDirMtimes: {},
  ue4ssDirMtime: null,
  mods: [],
  valid: false
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

  // --- 掃描 PAK mods（掃描所有可能的路徑）---
  const paksPaths = getAllPaksPaths(gamePath)
  for (const paksPath of paksPaths) {
    // Bug 12 fix: directory may not exist, wrap in try/catch
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

          mods.push({
            id: baseName,
            filename: file,
            title: baseName.replace('.pak', '').replace(/_/g, ' ').replace(/-/g, ' '),
            enabled: isPak,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            type: 'PAK',
            path: filePath
          })
        }
      }
    } catch (err) {
      logger.warn(`Failed to scan PAK directory ${paksPath}: ${err.message}`)
    }
  }

  // --- 掃描 UE4SS Lua mods ---
  const ue4ssModsPath = getUe4ssModsPath(gamePath)
  if (ue4ssModsPath && fs.existsSync(ue4ssModsPath)) {
    // 過濾 UE4SS 內建模組
    const builtinMods = new Set([
      'BPML_GenericFunctions', 'BPModLoaderMod', 'CheatManagerEnablerMod',
      'ConsoleCommandsMod', 'ConsoleEnablerMod', 'Keybinds',
      'LineTraceMod', 'SplitScreenMod', 'shared',
      'ActorDumperMod', 'jsbLuaProfilerMod'
    ])

    const dirs = fs.readdirSync(ue4ssModsPath)

    for (const dir of dirs) {
      if (builtinMods.has(dir)) continue

      const modDir = path.join(ue4ssModsPath, dir)
      const stat = fs.statSync(modDir)
      if (!stat.isDirectory()) continue

      // 確認是 Lua mod（有 Scripts/ 或 main.lua）
      const hasScripts = fs.existsSync(path.join(modDir, 'Scripts', 'main.lua'))
      const hasMainLua = fs.existsSync(path.join(modDir, 'main.lua'))
      const hasDlls = fs.readdirSync(modDir).some(f => f.endsWith('.dll'))
      if (!hasScripts && !hasMainLua && !hasDlls) continue

      const enabledFile = path.join(modDir, 'enabled.txt')
      const enabled = fs.existsSync(enabledFile)

      mods.push({
        id: `ue4ss:${dir}`,
        filename: dir,
        title: dir.replace(/_/g, ' ').replace(/-/g, ' '),
        enabled,
        size: 0,
        modified: stat.mtime.toISOString(),
        type: 'UE4SS',
        path: modDir
      })
    }
  }

  return mods
}

async function installMods(filePaths, mainWindow) {
  const gamePath = configStore.get('gamePath')
  if (!gamePath) throw new Error('Game path not set')

  const paksPath = getPaksPath(gamePath)
  const installed = []

  for (const filePath of filePaths) {
    const ext = path.extname(filePath).toLowerCase()

    if (ext === '.pak') {
      copyFile(filePath, paksPath)
      installed.push({ name: path.basename(filePath), type: 'pak-only' })
      logger.info(`Mod installed: ${path.basename(filePath)} (type: pak-only)`)
    } else if (ext === '.zip' || ext === '.rar') {
      const extractFn = ext === '.zip' ? extractZip : extractRar

      const { type } = await extractFn(filePath, null, true)

      if (type === 'pak-only') {
        await extractFn(filePath, paksPath)
      } else if (type === 'ue4ss-mod') {
        // UE4SS Lua mod → 解壓到 UE4SS Mods 資料夾
        const ue4ssModsPath = getUe4ssModsPath(gamePath)
        if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found. Please install UE4SS first.')
        await extractFn(filePath, ue4ssModsPath)
      } else {
        // game-structure / complex → 解壓到遊戲根目錄
        await extractFn(filePath, gamePath)
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
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const isPakMod = filename.endsWith('.pak') || filename.endsWith('.pak.disabled')

    if (!isPakMod) {
      // UE4SS mod toggle — filename 是資料夾名
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

    invalidateCache()
    logger.info(`Mod toggled: ${filename} → ${newPath.endsWith('.pak') ? 'enabled' : 'disabled'}`)
    return {
      id: path.basename(newPath).replace('.disabled', ''),
      filename: path.basename(newPath),
      enabled: newPath.endsWith('.pak'),
      path: newPath
    }
  })

  ipcMain.handle('mods:install', (_, filePaths) => installMods(filePaths, mainWindow))

  // --- Config 檔案管理 ---

  ipcMain.handle('mods:get-config-files', (_, modFilename) => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return []

    const isPakMod = modFilename.endsWith('.pak') || modFilename.endsWith('.pak.disabled')
    if (isPakMod) return [] // PAK mod 沒有 config 檔

    // UE4SS mod — 掃描資料夾內的 config 檔案
    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) return []

    const modDir = path.join(ue4ssModsPath, modFilename)
    if (!fs.existsSync(modDir)) return []

    const configExts = new Set(['.ini', '.cfg', '.conf', '.json', '.toml', '.yaml', '.yml', '.lua', '.xml'])
    const excludeFiles = new Set(['enabled.txt'])
    const results = []

    function scanDir(dir, relativeBase) {
      const entries = fs.readdirSync(dir)
      for (const entry of entries) {
        const fullPath = path.join(dir, entry)
        const relativePath = relativeBase ? path.join(relativeBase, entry) : entry
        const stat = fs.statSync(fullPath)

        if (stat.isDirectory()) {
          scanDir(fullPath, relativePath)
        } else if (stat.isFile()) {
          const ext = path.extname(entry).toLowerCase()
          if (configExts.has(ext) && !excludeFiles.has(entry.toLowerCase())) {
            results.push({
              name: entry,
              relativePath: relativePath.replace(/\\/g, '/'),
              size: stat.size
            })
          }
        }
      }
    }

    scanDir(modDir, '')
    return results
  })

  ipcMain.handle('mods:read-config', (_, modFilename, relativePath) => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')

    const filePath = path.join(ue4ssModsPath, modFilename, relativePath)

    // Bug 11 fix: prevent path traversal with proper boundary check
    const resolved = path.resolve(filePath)
    const modDir = path.resolve(path.join(ue4ssModsPath, modFilename))
    if (resolved !== modDir && !resolved.startsWith(modDir + path.sep)) throw new Error('Invalid path')

    if (!fs.existsSync(resolved)) throw new Error('File not found')
    return fs.readFileSync(resolved, 'utf-8')
  })

  ipcMain.handle('mods:save-config', (_, modFilename, relativePath, content) => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')

    const filePath = path.join(ue4ssModsPath, modFilename, relativePath)

    // Bug 11 fix: prevent path traversal with proper boundary check
    const resolved = path.resolve(filePath)
    const modDir = path.resolve(path.join(ue4ssModsPath, modFilename))
    if (resolved !== modDir && !resolved.startsWith(modDir + path.sep)) throw new Error('Invalid path')

    fs.writeFileSync(resolved, content, 'utf-8')
    return true
  })

  // --- 配置檔 Config 快照/還原 ---

  ipcMain.handle('profiles:snapshot-configs', () => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return {}

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) return {}

    const configExts = new Set(['.ini', '.cfg', '.conf', '.json', '.toml', '.yaml', '.yml', '.lua', '.xml'])
    const excludeFiles = new Set(['enabled.txt'])
    const snapshot = {}

    const builtinMods = new Set([
      'BPML_GenericFunctions', 'BPModLoaderMod', 'CheatManagerEnablerMod',
      'ConsoleCommandsMod', 'ConsoleEnablerMod', 'Keybinds',
      'LineTraceMod', 'SplitScreenMod', 'shared',
      'ActorDumperMod', 'jsbLuaProfilerMod'
    ])

    const dirs = fs.readdirSync(ue4ssModsPath)
    for (const dir of dirs) {
      if (builtinMods.has(dir)) continue
      const modDir = path.join(ue4ssModsPath, dir)
      if (!fs.statSync(modDir).isDirectory()) continue

      const modConfigs = {}

      function scanDir(dirPath, relativeBase) {
        const entries = fs.readdirSync(dirPath)
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry)
          const relativePath = relativeBase ? path.join(relativeBase, entry) : entry
          const stat = fs.statSync(fullPath)

          if (stat.isDirectory()) {
            scanDir(fullPath, relativePath)
          } else if (stat.isFile()) {
            const ext = path.extname(entry).toLowerCase()
            if (configExts.has(ext) && !excludeFiles.has(entry.toLowerCase())) {
              try {
                modConfigs[relativePath.replace(/\\/g, '/')] = fs.readFileSync(fullPath, 'utf-8')
              } catch {
                // 讀不到就跳過
              }
            }
          }
        }
      }

      scanDir(modDir, '')
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
      const modDir = path.join(ue4ssModsPath, modName)
      if (!fs.existsSync(modDir)) continue

      for (const [relativePath, content] of Object.entries(configs)) {
        const filePath = path.join(modDir, relativePath)

        // Bug 11 fix: prevent path traversal with proper boundary check
        const resolved = path.resolve(filePath)
        const modDirResolved = path.resolve(modDir)
        if (resolved !== modDirResolved && !resolved.startsWith(modDirResolved + path.sep)) continue

        // 確保目錄存在
        const dir = path.dirname(resolved)
        fs.mkdirSync(dir, { recursive: true })

        fs.writeFileSync(resolved, content, 'utf-8')
      }
    }

    invalidateCache()
    return true
  })

  ipcMain.handle('mods:remove', (_, filename) => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const isPakMod = filename.endsWith('.pak') || filename.endsWith('.pak.disabled')

    if (!isPakMod) {
      // UE4SS mod removal — filename 是資料夾名
      const ue4ssModsPath = getUe4ssModsPath(gamePath)
      if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')

      const modDir = path.join(ue4ssModsPath, filename)
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

    invalidateCache()
    logger.info(`Mod removed: ${filename}`)
    return true
  })

  // --- Preview archive contents before installing ---

  ipcMain.handle('mods:preview', async (_, filePaths) => {
    const results = []
    for (const filePath of filePaths) {
      const ext = path.extname(filePath).toLowerCase()
      try {
        if (ext === '.pak') {
          results.push({
            filePath,
            fileName: path.basename(filePath),
            type: 'pak-only',
            entries: [path.basename(filePath)],
            totalFiles: 1
          })
        } else if (ext === '.zip') {
          // Use extractZip in analyzeOnly mode to get type, then also read entries
          const StreamZip = (await import('node-stream-zip')).default
          const zip = new StreamZip.async({ file: filePath })
          try {
            const zipEntries = await zip.entries()
            const entryNames = Object.values(zipEntries).filter(e => !e.isDirectory).map(e => e.name)
            const analysis = await extractZip(filePath, null, true)
            results.push({
              filePath,
              fileName: path.basename(filePath),
              type: analysis.type,
              entries: entryNames.slice(0, 100),
              totalFiles: entryNames.length
            })
          } finally {
            await zip.close()
          }
        } else if (ext === '.rar') {
          const analysis = await extractRar(filePath, null, true)
          results.push({
            filePath,
            fileName: path.basename(filePath),
            type: analysis.type,
            entries: [],
            totalFiles: 0
          })
        }
      } catch (err) {
        logger.warn(`Preview failed for ${filePath}: ${err.message}`)
        results.push({
          filePath,
          fileName: path.basename(filePath),
          type: 'unknown',
          entries: [],
          totalFiles: 0,
          error: err.message
        })
      }
    }
    return results
  })

  // --- Read readme from UE4SS mod directory ---

  ipcMain.handle('mods:get-readme', (_, modFilename) => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return null

    const isPakMod = modFilename.endsWith('.pak') || modFilename.endsWith('.pak.disabled')
    if (isPakMod) return null

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) return null

    const modDir = path.join(ue4ssModsPath, modFilename)
    if (!fs.existsSync(modDir)) return null

    const readmeNames = ['README.md', 'readme.md', 'README.txt', 'readme.txt', 'README', 'readme', 'DESCRIPTION.txt', 'description.txt', 'INFO.txt', 'info.txt']

    for (const name of readmeNames) {
      const readmePath = path.join(modDir, name)
      if (fs.existsSync(readmePath)) {
        try {
          const content = fs.readFileSync(readmePath, 'utf-8')
          return { filename: name, content: content.slice(0, 5000) }
        } catch { return null }
      }
    }
    return null
  })

  // --- Download mod from URL then install ---

  ipcMain.handle('mods:download-url', async (_, url) => {
    // Validate URL
    if (!url || (!url.startsWith('https://') && !url.startsWith('http://'))) {
      throw new Error('Invalid URL')
    }

    // Determine filename from URL
    const urlObj = new URL(url)
    let filename = path.basename(urlObj.pathname)
    if (!filename || !filename.match(/\.(zip|rar|pak)$/i)) {
      filename = `mod_download_${Date.now()}.zip`
    }

    const tempPath = path.join(configStore.getConfigDir(), 'temp', filename)
    fs.mkdirSync(path.dirname(tempPath), { recursive: true })

    try {
      await downloadFile(url, tempPath, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('mods:download-progress', progress)
        }
      })

      // Install the downloaded file
      const result = await installMods([tempPath], mainWindow)

      // Clean up temp file
      try { fs.unlinkSync(tempPath) } catch {}

      return result
    } catch (err) {
      try { fs.unlinkSync(tempPath) } catch {}
      throw err
    }
  })

  // --- Backup/Restore all mods ---

  ipcMain.handle('mods:backup', async () => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const backupDir = path.join(configStore.getConfigDir(), 'backups')
    fs.mkdirSync(backupDir, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const backupPath = path.join(backupDir, `mods_backup_${timestamp}`)
    fs.mkdirSync(backupPath, { recursive: true })

    // Backup PAK mods
    const paksPaths = getAllPaksPaths(gamePath)
    const pakBackupDir = path.join(backupPath, 'paks')
    fs.mkdirSync(pakBackupDir, { recursive: true })

    for (const paksPath of paksPaths) {
      try {
        const files = fs.readdirSync(paksPath)
        for (const file of files) {
          const lower = file.toLowerCase()
          if (lower.startsWith('pakchunk') || lower.startsWith('global')) continue
          if (file.endsWith('.pak') || file.endsWith('.pak.disabled')) {
            fs.copyFileSync(path.join(paksPath, file), path.join(pakBackupDir, file))
          }
        }
      } catch {}
    }

    // Backup UE4SS mods
    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (ue4ssModsPath && fs.existsSync(ue4ssModsPath)) {
      const ue4ssBackupDir = path.join(backupPath, 'ue4ss_mods')
      const builtinMods = new Set([
        'BPML_GenericFunctions', 'BPModLoaderMod', 'CheatManagerEnablerMod',
        'ConsoleCommandsMod', 'ConsoleEnablerMod', 'Keybinds',
        'LineTraceMod', 'SplitScreenMod', 'shared',
        'ActorDumperMod', 'jsbLuaProfilerMod'
      ])

      const dirs = fs.readdirSync(ue4ssModsPath)
      for (const dir of dirs) {
        if (builtinMods.has(dir)) continue
        const modDir = path.join(ue4ssModsPath, dir)
        if (!fs.statSync(modDir).isDirectory()) continue

        const destDir = path.join(ue4ssBackupDir, dir)
        copyDirSync(modDir, destDir)
      }
    }

    // Save metadata
    fs.writeFileSync(path.join(backupPath, 'backup.json'), JSON.stringify({
      timestamp,
      gamePath,
      date: new Date().toISOString()
    }, null, 2))

    logger.info(`Backup created: ${backupPath}`)
    return { path: backupPath, timestamp }
  })

  ipcMain.handle('mods:list-backups', () => {
    const backupDir = path.join(configStore.getConfigDir(), 'backups')
    if (!fs.existsSync(backupDir)) return []

    return fs.readdirSync(backupDir)
      .filter(d => d.startsWith('mods_backup_'))
      .map(d => {
        const backupPath = path.join(backupDir, d)
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(backupPath, 'backup.json'), 'utf-8'))
          return { name: d, path: backupPath, ...meta }
        } catch {
          return { name: d, path: backupPath, timestamp: d.replace('mods_backup_', '') }
        }
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  })

  ipcMain.handle('mods:restore-backup', async (_, backupPath) => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    // Restore PAK mods
    const pakBackupDir = path.join(backupPath, 'paks')
    if (fs.existsSync(pakBackupDir)) {
      const paksPath = getPaksPath(gamePath)
      const files = fs.readdirSync(pakBackupDir)
      for (const file of files) {
        fs.copyFileSync(path.join(pakBackupDir, file), path.join(paksPath, file))
      }
    }

    // Restore UE4SS mods
    const ue4ssBackupDir = path.join(backupPath, 'ue4ss_mods')
    if (fs.existsSync(ue4ssBackupDir)) {
      const ue4ssModsPath = getUe4ssModsPath(gamePath)
      if (ue4ssModsPath) {
        const dirs = fs.readdirSync(ue4ssBackupDir)
        for (const dir of dirs) {
          const src = path.join(ue4ssBackupDir, dir)
          const dest = path.join(ue4ssModsPath, dir)
          copyDirSync(src, dest)
        }
      }
    }

    invalidateCache()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mods:updated')
    }

    logger.info(`Backup restored: ${backupPath}`)
    return true
  })
}

export { registerModsIpc }
