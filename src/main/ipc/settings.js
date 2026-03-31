import { ipcMain, dialog, shell } from 'electron'
import configStore from '../services/config-store.js'

function registerSettingsIpc() {
  ipcMain.handle('settings:get', (_, key, defaultValue) => {
    return configStore.get(key, defaultValue)
  })

  ipcMain.handle('settings:set', (_, key, value) => {
    configStore.set(key, value)
  })

  ipcMain.handle('dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:select-files', async (_, filters) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: filters || [
        { name: 'Mod Files', extensions: ['zip', 'rar', 'pak'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('shell:open-external', (_, url) => {
    if (typeof url !== 'string') return
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
    } catch {
      return
    }
    shell.openExternal(url)
  })

  ipcMain.handle('shell:open-path', (_, filePath) => {
    if (typeof filePath !== 'string') return
    shell.openPath(filePath)
  })
}

export { registerSettingsIpc }
