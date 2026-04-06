import { ipcMain, app } from 'electron'
import { spawn } from 'child_process'
import { checkForUpdate, downloadUpdate } from '../services/app-updater.js'
import configStore from '../services/config-store.js'
import path from 'path'
import fs from 'fs'
import logger from '../services/logger.js'

function registerAppUpdateIpc(mainWindow) {
  ipcMain.handle('app-update:get-version', () => {
    return app.getVersion()
  })

  ipcMain.handle('app-update:check', async () => {
    try {
      return await checkForUpdate()
    } catch (err) {
      logger.error(`Update check failed: ${err.message}`)
      return { hasUpdate: false, currentVersion: app.getVersion(), error: err.message }
    }
  })

  // Bug 9 fix: accept downloadUrl from frontend to avoid redundant checkForUpdate call
  ipcMain.handle('app-update:download', async (_, downloadUrl) => {
    try {
      if (!downloadUrl) {
        throw new Error('No download URL provided')
      }

      const filePath = await downloadUpdate(downloadUrl, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('app-update:progress', progress)
        }
      })

      return { filePath }
    } catch (err) {
      logger.error(`Update download failed: ${err.message}`)
      throw err
    }
  })

  ipcMain.handle('app-update:install', () => {
    const exePath = path.join(configStore.getConfigDir(), 'hzmm-update.exe')
    if (!fs.existsSync(exePath)) {
      throw new Error('Update file not found. Please download first.')
    }

    logger.info('Installing update and quitting app...')

    // Bug 3 fix: listen for spawn error, only quit after a short delay
    const child = spawn(exePath, [], {
      detached: true,
      stdio: 'ignore'
    })

    let spawnFailed = false

    child.on('error', (err) => {
      spawnFailed = true
      logger.error(`Failed to start installer: ${err.message}`)
    })

    child.unref()

    setTimeout(() => {
      if (!spawnFailed) {
        app.quit()
      } else {
        logger.error('Not quitting app because installer failed to start')
      }
    }, 1000)
  })
}

export { registerAppUpdateIpc }
