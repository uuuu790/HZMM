const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // --- 模組管理 ---
  mods: {
    scan: () => ipcRenderer.invoke('mods:scan'),
    toggle: (filename) => ipcRenderer.invoke('mods:toggle', filename),
    install: (filePaths) => ipcRenderer.invoke('mods:install', filePaths),
    remove: (filename) => ipcRenderer.invoke('mods:remove', filename),
    getConfigFiles: (modFilename) => ipcRenderer.invoke('mods:get-config-files', modFilename),
    readConfig: (modFilename, relativePath) => ipcRenderer.invoke('mods:read-config', modFilename, relativePath),
    saveConfig: (modFilename, relativePath, content) => ipcRenderer.invoke('mods:save-config', modFilename, relativePath, content),
    snapshotConfigs: () => ipcRenderer.invoke('profiles:snapshot-configs'),
    restoreConfigs: (configSnapshot) => ipcRenderer.invoke('profiles:restore-configs', configSnapshot),
    invalidateCache: () => ipcRenderer.invoke('mods:invalidate-cache'),
    onUpdated: (cb) => {
      const handler = () => cb()
      ipcRenderer.on('mods:updated', handler)
      return () => ipcRenderer.removeListener('mods:updated', handler)
    }
  },

  // --- UE4SS 引擎 ---
  ue4ss: {
    getStatus: () => ipcRenderer.invoke('ue4ss:status'),
    install: () => ipcRenderer.invoke('ue4ss:install'),
    update: () => ipcRenderer.invoke('ue4ss:update'),
    onProgress: (cb) => {
      const handler = (_, progress) => cb(progress)
      ipcRenderer.on('ue4ss:progress', handler)
      return () => ipcRenderer.removeListener('ue4ss:progress', handler)
    }
  },

  // --- 遊戲 ---
  game: {
    detectPath: () => ipcRenderer.invoke('game:detect-path'),
    getPath: () => ipcRenderer.invoke('game:get-path'),
    setPath: (path) => ipcRenderer.invoke('game:set-path', path),
    getPaksPath: () => ipcRenderer.invoke('game:get-paks-path'),
    getVersion: () => ipcRenderer.invoke('game:get-version'),
    launch: () => ipcRenderer.invoke('game:launch'),
    isRunning: () => ipcRenderer.invoke('game:is-running')
  },

  // --- 設定 ---
  settings: {
    get: (key, defaultValue) => ipcRenderer.invoke('settings:get', key, defaultValue),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value)
  },

  // --- App 更新 ---
  appUpdate: {
    check: () => ipcRenderer.invoke('app-update:check'),
    getVersion: () => ipcRenderer.invoke('app-update:get-version'),
    download: () => ipcRenderer.invoke('app-update:download'),
    install: () => ipcRenderer.invoke('app-update:install'),
    onProgress: (cb) => {
      const handler = (_, progress) => cb(progress)
      ipcRenderer.on('app-update:progress', handler)
      return () => ipcRenderer.removeListener('app-update:progress', handler)
    }
  },

  // --- 衝突偵測 ---
  conflicts: {
    scan: () => ipcRenderer.invoke('conflicts:scan')
  },

  // --- 日誌 ---
  logger: {
    getPath: () => ipcRenderer.invoke('logger:get-path'),
    readRecent: () => ipcRenderer.invoke('logger:read-recent')
  },

  // --- 語言 ---
  locale: {
    getSupported: () => ipcRenderer.invoke('locale:get-supported'),
    detect: () => ipcRenderer.invoke('locale:detect'),
    getPreference: () => ipcRenderer.invoke('locale:get-preference'),
    setPreference: (code) => ipcRenderer.invoke('locale:set-preference', code)
  },

  // --- 系統 ---
  system: {
    selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
    selectFiles: (filters) => ipcRenderer.invoke('dialog:select-files', filters),
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
    openPath: (filePath) => ipcRenderer.invoke('shell:open-path', filePath)
  }
})

// --- 拖放檔案處理 ---
function handleFileDrop(e) {
  e.preventDefault()
  const files = Array.from(e.dataTransfer.files)
  const paths = files
    .map(f => webUtils.getPathForFile(f))
    .filter(p => {
      if (!p) return false
      const lower = p.toLowerCase()
      return lower.endsWith('.zip') || lower.endsWith('.pak') || lower.endsWith('.rar')
    })

  if (paths.length > 0) {
    ipcRenderer.invoke('mods:install', paths).catch(err => {
      console.error('Mod install failed:', err)
    })
  }
}

function preventDragDefault(e) { e.preventDefault() }

// 在所有可能的層級和階段註冊，確保能捕獲到拖放事件
window.addEventListener('dragover', preventDragDefault, true)
window.addEventListener('dragover', preventDragDefault, false)
window.addEventListener('drop', handleFileDrop, true)
window.addEventListener('drop', handleFileDrop, false)

document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('dragover', preventDragDefault, true)
  document.addEventListener('dragover', preventDragDefault, false)
  document.addEventListener('drop', handleFileDrop, true)
  document.addEventListener('drop', handleFileDrop, false)
  document.body.addEventListener('dragover', preventDragDefault, true)
  document.body.addEventListener('drop', handleFileDrop, true)
})
