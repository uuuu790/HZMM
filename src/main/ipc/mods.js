import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import { getPaksPath, getAllPaksPaths, getUe4ssModsPath } from '../services/steam-detector.js'
import { extractZip, extractRar, copyFile } from '../services/archive.js'

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
    }
  }

  invalidateCache()

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mods:updated')
  }

  return installed
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
      return {
        id: `ue4ss:${filename}`,
        filename,
        enabled: !isEnabled,
        path: modDir
      }
    }

    // PAK mod toggle
    const paksPath = getPaksPath(gamePath)
    const filePath = path.join(paksPath, filename)

    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filename}`)

    let newPath
    if (filename.endsWith('.pak.disabled')) {
      newPath = filePath.replace('.disabled', '')
    } else {
      newPath = filePath + '.disabled'
    }

    fs.renameSync(filePath, newPath)

    invalidateCache()
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

    // 防止路徑穿越攻擊
    const resolved = path.resolve(filePath)
    const modDir = path.resolve(path.join(ue4ssModsPath, modFilename))
    if (!resolved.startsWith(modDir)) throw new Error('Invalid path')

    if (!fs.existsSync(resolved)) throw new Error('File not found')
    return fs.readFileSync(resolved, 'utf-8')
  })

  ipcMain.handle('mods:save-config', (_, modFilename, relativePath, content) => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')

    const filePath = path.join(ue4ssModsPath, modFilename, relativePath)

    // 防止路徑穿越攻擊
    const resolved = path.resolve(filePath)
    const modDir = path.resolve(path.join(ue4ssModsPath, modFilename))
    if (!resolved.startsWith(modDir)) throw new Error('Invalid path')

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

        // 防止路徑穿越
        const resolved = path.resolve(filePath)
        const modDirResolved = path.resolve(modDir)
        if (!resolved.startsWith(modDirResolved)) continue

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
      return true
    }

    // PAK mod removal
    const paksPath = getPaksPath(gamePath)
    const filePath = path.join(paksPath, filename)

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    invalidateCache()
    return true
  })
}

export { registerModsIpc }
