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

  ipcMain.handle('app-update:download', async () => {
    try {
      const updateInfo = await checkForUpdate()
      if (!updateInfo.hasUpdate || !updateInfo.downloadUrl) {
        throw new Error('No update available or no download URL')
      }

      const filePath = await downloadUpdate(updateInfo.downloadUrl, (progress) => {
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
    const exePath = path.join(configStore.CONFIG_DIR, 'hzmm-update.exe')
    if (!fs.existsSync(exePath)) {
      throw new Error('Update file not found. Please download first.')
    }

    logger.info('Installing update and quitting app...')

    const child = spawn(exePath, [], {
      detached: true,
      stdio: 'ignore'
    })
    child.unref()

    app.quit()
  })
}

export { registerAppUpdateIpc }
