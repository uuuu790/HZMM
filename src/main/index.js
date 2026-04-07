import { app, BrowserWindow, shell, ipcMain, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import windowStateKeeper from 'electron-window-state'

import { registerModsIpc } from './ipc/mods'
import { registerSavesIpc } from './ipc/saves'
import { registerUe4ssIpc } from './ipc/ue4ss'
import { registerGameIpc } from './ipc/game'
import { registerSettingsIpc } from './ipc/settings'
import { registerLocaleIpc } from './ipc/locale'
import { registerAppUpdateIpc } from './ipc/app-update'
import { registerConflictsIpc } from './ipc/conflicts'
import logger from './services/logger.js'
import configStore from './services/config-store.js'

const is = { dev: !app.isPackaged }

let mainWindow
let tray = null
let ipcRegistered = false
let isQuitting = false

function registerAllIpc(mainWindow) {
  if (ipcRegistered) return
  ipcRegistered = true

  registerModsIpc(mainWindow)
  registerSavesIpc(mainWindow)
  registerUe4ssIpc(mainWindow)
  registerGameIpc(mainWindow)
  registerSettingsIpc()
  registerLocaleIpc()
  registerAppUpdateIpc(mainWindow)
  registerConflictsIpc()

  // Logger IPC
  ipcMain.handle('logger:get-path', () => logger.getPath())
  ipcMain.handle('logger:read-recent', () => logger.readRecent())

  // Title bar overlay theme
  ipcMain.handle('app:set-titlebar-theme', (_, isDark) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitleBarOverlay({
        color: isDark ? '#02061700' : '#f8fafc00',
        symbolColor: isDark ? '#94a3b8' : '#6b7280',
      })
    }
  })

  // Tray IPC
  ipcMain.handle('app:quit', () => {
    isQuitting = true
    app.quit()
  })

  // Auto-start setting
  ipcMain.handle('app:get-auto-start', () => {
    return app.getLoginItemSettings().openAtLogin
  })

  ipcMain.handle('app:set-auto-start', (_, enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled })
  })

}

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
    icon: is.dev
      ? join(__dirname, '../../resources/icon.ico')
      : join(process.resourcesPath, 'icon.ico'),
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
      nodeIntegration: false,
      navigateOnDragDrop: false
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

  // Notify renderer of visibility changes
  mainWindow.on('hide', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:visibility', false)
    }
  })

  mainWindow.on('show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:visibility', true)
    }
  })

  // 關閉按鈕 → 根據設定決定最小化到系統匣或直接退出
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      const minimizeToTray = configStore.get('minimizeToTray', true)
      if (minimizeToTray) {
        e.preventDefault()
        mainWindow.hide()
      } else {
        isQuitting = true
      }
    }
  })

  // 防止拖放導航
  mainWindow.webContents.on('will-navigate', (e) => { e.preventDefault() })

  // Register all IPC handlers (guarded against duplicate registration)
  registerAllIpc(mainWindow)

  logger.info(`HZMM Manager started — version ${app.getVersion()}`)

  // Load the renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray() {
  const iconPath = is.dev
    ? join(__dirname, '../../resources/icon.ico')
    : join(process.resourcesPath, 'icon.ico')

  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('HZMM Manager')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '顯示 HZMM',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: '結束',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  // 點擊匣圖標 → 顯示視窗
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(() => {
  createTray()
  createWindow()
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  // 不自動退出，讓 tray 保持運行
})
