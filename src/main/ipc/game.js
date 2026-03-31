import { ipcMain } from 'electron'
import fs from 'fs'
import { spawn } from 'child_process'
import { detectGamePath, getPaksPath, getGameExe, getGameVersion } from '../services/steam-detector.js'
import configStore from '../services/config-store.js'

function registerGameIpc(mainWindow) {
  ipcMain.handle('game:detect-path', () => {
    // Check cache first
    const cached = configStore.get('gamePath')
    if (cached) {
      if (fs.existsSync(cached)) return cached
    }

    const detected = detectGamePath()
    if (detected) {
      configStore.set('gamePath', detected)
    }
    return detected
  })

  ipcMain.handle('game:get-path', () => {
    return configStore.get('gamePath', null)
  })

  ipcMain.handle('game:set-path', (_, gamePath) => {
    configStore.set('gamePath', gamePath)
  })

  ipcMain.handle('game:get-paks-path', () => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return null
    return getPaksPath(gamePath)
  })

  ipcMain.handle('game:get-version', async () => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return null
    return await getGameVersion(gamePath)
  })

  ipcMain.handle('game:launch', () => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const exePath = getGameExe(gamePath)
    if (!exePath) throw new Error('Game executable not found')

    const child = spawn(exePath, [], {
      cwd: gamePath,
      detached: true,
      stdio: 'ignore'
    })
    child.unref()

    return true
  })
}

export { registerGameIpc }
