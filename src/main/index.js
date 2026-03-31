import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import windowStateKeeper from 'electron-window-state'

import { registerModsIpc } from './ipc/mods'
import { registerUe4ssIpc } from './ipc/ue4ss'
import { registerGameIpc } from './ipc/game'
import { registerSettingsIpc } from './ipc/settings'
import { registerLocaleIpc } from './ipc/locale'
import { registerAppUpdateIpc } from './ipc/app-update'
import { registerConflictsIpc } from './ipc/conflicts'
import logger from './services/logger.js'

const is = { dev: !app.isPackaged }

let mainWindow

function createWindow() {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1280,
    defaultHeight: 800
  })

  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#6b7280',
      height: 36
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindowState.manage(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 保底：5 秒後如果視窗還沒顯示，強制顯示
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  }, 5000)

  // 捕獲渲染器錯誤
  mainWindow.webContents.on('render-process-gone', (_, details) => {
    console.error('Renderer crashed:', details.reason)
  })

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 防止拖放導航
  mainWindow.webContents.on('will-navigate', (e) => { e.preventDefault() })

  // Register all IPC handlers
  registerModsIpc(mainWindow)
  registerUe4ssIpc(mainWindow)
  registerGameIpc(mainWindow)
  registerSettingsIpc()
  registerLocaleIpc()
  registerAppUpdateIpc(mainWindow)
  registerConflictsIpc()

  // Logger IPC
  ipcMain.handle('logger:get-path', () => logger.getPath())
  ipcMain.handle('logger:read-recent', () => logger.readRecent())

  logger.info(`HZMM Manager started — version ${app.getVersion()}`)

  // Load the renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
