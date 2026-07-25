// Minimal `electron` stand-in for unit tests.
//
// Aliased in vitest.config.mjs so any src/main module can be imported directly.
// Before this existed, importing a main-process file pulled in the real
// `electron` package (which throws outside an Electron runtime), so tests that
// wanted to cover that logic re-implemented it inline instead — which meant the
// real function could regress with every test still green. Import the real
// module; stub the runtime.
//
// `ipcMain.handle` records handlers so a test can register the IPC surface and
// then invoke a channel exactly as the renderer would.

const handlers = new Map()
const listeners = new Map()

function reset() {
  handlers.clear()
  listeners.clear()
  shell.calls.length = 0
}

export const ipcMain = {
  handle(channel, fn) {
    handlers.set(channel, fn)
  },
  on(channel, fn) {
    listeners.set(channel, fn)
  },
  removeHandler(channel) {
    handlers.delete(channel)
  },
  // Test-only helpers
  _handlers: handlers,
  _invoke(channel, ...args) {
    const fn = handlers.get(channel)
    if (!fn) throw new Error(`No IPC handler registered for "${channel}"`)
    // Real ipcMain passes an IpcMainInvokeEvent first.
    return fn({ sender: {} }, ...args)
  },
  _reset: reset,
}

export const shell = {
  calls: [],
  openExternal(url) {
    shell.calls.push(['openExternal', url])
    return Promise.resolve()
  },
  openPath(p) {
    shell.calls.push(['openPath', p])
    return Promise.resolve('')
  },
  showItemInFolder(p) {
    shell.calls.push(['showItemInFolder', p])
  },
}

export const app = {
  getVersion: () => '0.0.0-test',
  getPath: (name) => `/tmp/hzmm-test/${name}`,
  getLoginItemSettings: () => ({ openAtLogin: false }),
  setLoginItemSettings: () => {},
  isPackaged: false,
  quit: () => {},
  on: () => {},
  whenReady: () => Promise.resolve(),
  requestSingleInstanceLock: () => true,
}

export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showMessageBox: async () => ({ response: 0 }),
}

class BrowserWindowStub {
  constructor() {
    this.webContents = { send: () => {}, on: () => {}, setZoomFactor: () => {} }
  }
  isDestroyed() { return false }
  on() {}
  loadFile() {}
  loadURL() {}
}
export const BrowserWindow = BrowserWindowStub

export const Tray = class { setToolTip() {} setContextMenu() {} on() {} destroy() {} }
export const Menu = { buildFromTemplate: () => ({}) }
export const nativeImage = { createFromPath: () => ({ resize: () => ({}), isEmpty: () => true }) }
export const screen = {
  getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
}

export const contextBridge = { exposeInMainWorld: () => {} }
export const ipcRenderer = { invoke: async () => {}, on: () => {}, removeListener: () => {} }
export const webUtils = { getPathForFile: () => '' }
export const webFrame = { setZoomFactor: () => {} }

export default {
  app, ipcMain, shell, dialog, BrowserWindow, Tray, Menu, nativeImage, screen,
  contextBridge, ipcRenderer, webUtils, webFrame,
}
