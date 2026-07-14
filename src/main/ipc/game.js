import { ipcMain, shell } from 'electron'
import fs from 'fs'
import { spawn } from 'child_process'
import { detectGamePath, getPaksPath, getGameExe, getGameVersion, getGameVersionCached, isSteamGame, HUMANITZ_APP_ID } from '../services/steam-detector.js'
import configStore from '../services/config-store.js'
import { isGameRunning } from '../services/process-detector.js'
import logger from '../services/logger.js'

function registerGameIpc() {
  ipcMain.handle('game:detect-path', () => {
    // Check cache first
    const cached = configStore.get('gamePath')
    if (cached) {
      if (fs.existsSync(cached)) return cached
    }

    const detected = detectGamePath()
    if (detected) {
      configStore.set('gamePath', detected)
      logger.info(`Game path detected: ${detected}`)
    }
    return detected
  })

  ipcMain.handle('game:get-path', () => {
    return configStore.get('gamePath', null)
  })

  ipcMain.handle('game:set-path', (_, gamePath) => {
    if (!gamePath || !fs.existsSync(gamePath)) return { valid: false, reason: 'path-not-found' }

    // Readdir can throw on permission / transient filesystem errors — fold
    // those into a user-facing "not-game-folder" response instead of a
    // stack trace back to the renderer.
    const readSafe = (p) => { try { return fs.readdirSync(p) } catch { return null } }
    const entries = readSafe(gamePath)
    if (!entries) return { valid: false, reason: 'not-game-folder' }

    // Check if this is the game root (has exe) or user selected a subfolder
    const hasExe = entries.some(f => f.toLowerCase().endsWith('.exe') && !f.toLowerCase().includes('crash') && !f.toLowerCase().includes('unins'))
    const hasContentFolder = fs.existsSync(require('path').join(gamePath, 'HumanitZ', 'Content'))

    if (!hasExe && !hasContentFolder) {
      // Maybe they selected the parent or a wrong folder entirely
      // Try checking if HumanitZ is a subfolder
      const sub = require('path').join(gamePath, 'HumanitZ')
      const subEntries = readSafe(sub)
      if (subEntries && subEntries.some(f => f.toLowerCase().endsWith('.exe'))) {
        // They selected steamapps/common instead of the game folder
        return { valid: false, reason: 'select-subfolder', suggestion: sub }
      }
      return { valid: false, reason: 'not-game-folder' }
    }

    configStore.set('gamePath', gamePath)
    logger.info(`Game path set manually: ${gamePath}`)
    return { valid: true }
  })

  ipcMain.handle('game:get-paks-path', () => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return null
    return getPaksPath(gamePath)
  })

  ipcMain.handle('game:get-version-cached', () => {
    return getGameVersionCached()
  })

  ipcMain.handle('game:get-version', () => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return null
    return getGameVersion(gamePath)
  })

  ipcMain.handle('game:launch', async () => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    // 當 gamePath 是 Steam 安裝的副本時，透過 Steam 啟動而非直接 spawn exe。
    // HumanitZ 無 steam_appid.txt，直接啟動會繞過 Steam，使 Steam API 無法以正確
    // appID 初始化 → 多人主機綁定失敗 (Could not bind local address)。交給 Steam
    // 啟動可正確初始化 Steamworks 並由 Steam 管理整條進程鏈。
    if (isSteamGame(gamePath)) {
      await shell.openExternal(`steam://rungameid/${HUMANITZ_APP_ID}`)
      logger.info('Game launched via Steam')
      return true
    }

    // 非 Steam 副本 (手動設定的非 Steam 安裝) — 直接啟動 exe，並把立即的
    // spawn 失敗 (ENOENT/EACCES) 回報給 renderer，而非假裝成功。
    const exePath = getGameExe(gamePath)
    if (!exePath) throw new Error('Game executable not found')
    return new Promise((resolve, reject) => {
      let settled = false
      const child = spawn(exePath, [], { cwd: gamePath, detached: true, stdio: 'ignore' })
      child.on('error', (err) => {
        if (settled) return
        settled = true
        logger.error('Game launch (direct fallback) failed: ' + err.message)
        reject(err)
      })
      setTimeout(() => {
        if (settled) return
        settled = true
        child.unref()
        logger.info(`Game launched (direct fallback): ${exePath}`)
        resolve(true)
      }, 200)
    })
  })

  ipcMain.handle('game:is-running', () => isGameRunning())
}

// Game-running detection lives in the main process. Node timers are NOT subject
// to the renderer's background throttling, which on Windows is unreliable while
// the window is hidden/minimized (electron#31016) — so renderer-side polling
// could miss the game exiting while HZMM sat in the tray and show a stale
// "running" state on reopen. We poll here, push only on change, and re-assert
// the current state on window 'show' so reopening from the tray is never stale.
//
// This is WINDOW-SCOPED and must be (re)started on every createWindow() — NOT
// folded into the one-time registerGameIpc() above — otherwise a window rebuilt
// from the tray gets a dead interval bound to the first (destroyed) window and
// game-running detection silently stops. Any prior interval is torn down first.
let runningTimer = null
let lastRunning = null

function startGameRunningPolling(mainWindow) {
  if (runningTimer) { clearInterval(runningTimer); runningTimer = null }
  lastRunning = null
  const pushRunning = async () => {
    if (mainWindow.isDestroyed()) return
    let running
    try { running = await isGameRunning() } catch { return }
    // isGameRunning() shells out to `tasklist` (tens–hundreds ms); the window
    // may have been closed during that await. Re-check before sending or
    // webContents.send throws "Object has been destroyed" as an unhandled
    // rejection (this runs from setInterval, not an awaited caller).
    if (mainWindow.isDestroyed()) return
    if (running === lastRunning) return
    lastRunning = running
    mainWindow.webContents.send('game:running', running)
  }
  runningTimer = setInterval(pushRunning, 5000)
  pushRunning()
  mainWindow.on('show', () => {
    if (!mainWindow.isDestroyed() && lastRunning !== null) {
      mainWindow.webContents.send('game:running', lastRunning)
    }
  })
  mainWindow.on('closed', () => {
    if (runningTimer) { clearInterval(runningTimer); runningTimer = null }
  })
}

export { registerGameIpc, startGameRunningPolling }
