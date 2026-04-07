import { ipcMain, app } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import { getPaksPath, getAllPaksPaths, getUe4ssModsPath } from '../services/steam-detector.js'
import { extractZip, extractRar, copyFile, downloadFile, analyzeArchiveStructure } from '../services/archive.js'
import logger from '../services/logger.js'
import { BUILTIN_MODS, CONFIG_EXTENSIONS } from './constants.js'

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
    const dirs = fs.readdirSync(ue4ssModsPath)

    for (const dir of dirs) {
      if (BUILTIN_MODS.has(dir) || dir.startsWith('.')) continue

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

      const analysis = await extractFn(filePath, null, true)
      const { type, hasGameStructure } = analysis

      if (type === 'pak-only') {
        await extractFn(filePath, paksPath)
      } else if (type === 'ue4ss-mod' && !hasGameStructure) {
        // UE4SS mod（無遊戲目錄結構）→ 解壓到 UE4SS Mods 資料夾
        const ue4ssModsPath = getUe4ssModsPath(gamePath)
        if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found. Please install UE4SS first.')
        await extractFn(filePath, ue4ssModsPath)
      } else {
        // game-structure / ue4ss-mod with game structure / complex → 解壓到遊戲根目錄
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

    const configExts = new Set(CONFIG_EXTENSIONS)
    const excludeFiles = new Set(['enabled.txt'])
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

    const configExts = new Set(CONFIG_EXTENSIONS)
    const excludeFiles = new Set(['enabled.txt'])
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

    if (!found) throw new Error(`PAK file not found: ${filename}`)

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
          results.push({ filePath, fileName: path.basename(filePath), type: 'pak-only', entries: [path.basename(filePath)], totalFiles: 1 })
        } else if (ext === '.zip') {
          const StreamZip = (await import('node-stream-zip')).default
          const zip = new StreamZip.async({ file: filePath })
          try {
            const zipEntries = await zip.entries()
            const allNames = Object.values(zipEntries).map(e => e.name)
            const fileNames = allNames.filter(n => !n.endsWith('/'))
            const analysis = analyzeArchiveStructure(allNames)
            results.push({ filePath, fileName: path.basename(filePath), type: analysis.type, entries: fileNames.slice(0, 100), totalFiles: fileNames.length })
          } finally { await zip.close() }
        } else if (ext === '.rar') {
          const analysis = await extractRar(filePath, null, true)
          results.push({ filePath, fileName: path.basename(filePath), type: analysis.type, entries: [], totalFiles: 0 })
        }
      } catch (err) {
        logger.warn(`Preview failed for ${filePath}: ${err.message}`)
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
    if (isPakMod) return null
    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) return null
    const modDir = path.join(ue4ssModsPath, modFilename)
    if (!fs.existsSync(modDir)) return null
    const readmeNames = ['README.md', 'readme.md', 'README.txt', 'readme.txt', 'README', 'readme', 'DESCRIPTION.txt', 'description.txt', 'INFO.txt', 'info.txt']
    for (const name of readmeNames) {
      const readmePath = path.join(modDir, name)
      if (fs.existsSync(readmePath)) {
        try { return { filename: name, content: fs.readFileSync(readmePath, 'utf-8').slice(0, 5000) } } catch { return null }
      }
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

  // Allowed hosts for mod downloads (Nexus CDN resolved URLs are also allowed)
  const ALLOWED_MOD_HOSTS = [
    'nexusmods.com',
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
  ]

  function isAllowedModUrl(urlStr) {
    try {
      const parsed = new URL(urlStr)
      if (parsed.protocol !== 'https:') return false
      return ALLOWED_MOD_HOSTS.some(host =>
        parsed.hostname === host || parsed.hostname.endsWith('.' + host)
      )
    } catch {
      return false
    }
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
      try { fs.unlinkSync(tempPath) } catch {}
      return result
    } catch (err) {
      try { fs.unlinkSync(tempPath) } catch {}
      throw err
    }
  })

}

export { registerModsIpc, scanMods }
