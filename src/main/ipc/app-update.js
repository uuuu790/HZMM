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
    const newExePath = path.join(configStore.getConfigDir(), 'hzmm-update.exe')
    if (!fs.existsSync(newExePath)) {
      throw new Error('Update file not found. Please download first.')
    }

    const currentExePath = app.getPath('exe')
    const batPath = path.join(configStore.getConfigDir(), 'updater.bat')

    // Generate batch script to replace exe after app closes
    const batContent = [
      '@echo off',
      'timeout /t 2 /nobreak >nul',
      `copy /y "${newExePath}" "${currentExePath}" >nul`,
      `del /f "${newExePath}" >nul`,
      `start "" "${currentExePath}"`,
      `del /f "%~f0" >nul`
    ].join('\r\n')

    fs.writeFileSync(batPath, batContent, 'utf-8')
    logger.info(`Update script created: ${batPath}`)
    logger.info(`Replacing: ${currentExePath}`)

    const child = spawn('cmd', ['/c', batPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })

    child.on('error', (err) => {
      logger.error(`Failed to start updater: ${err.message}`)
    })

    child.unref()

    setTimeout(() => {
      app.quit()
    }, 500)
  })
}

export { registerAppUpdateIpc }
