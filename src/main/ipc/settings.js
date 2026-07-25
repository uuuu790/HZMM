import { ipcMain, dialog, shell } from 'electron'
import path from 'path'
import configStore from '../services/config-store.js'
import { isExecutableExt } from '../services/path-safety.js'
import { openExternalSafe } from '../services/external-link.js'

// NOTE: several keys were removed after being confirmed unread across main +
// renderer: `language` (now `lang` via locale:set-preference), `theme`
// (superseded by `themeId`), `autoCheckUpdate`, `modSortOrder`,
// `modSortDirection`, and `lastTab`. Keeping the whitelist tight stops the
// renderer writing dead keys to the config file.
// Exported so unit tests can verify the whitelist directly without spinning
// up Electron / the IPC handler.
// NOTE: `gamePath` is deliberately NOT here. It is the root every other
// filesystem operation is resolved against — install targets, the UE4SS Mods
// folder, shell:open-path's allow-list, the exe game:launch spawns — and
// settings:set performs no value validation whatsoever, so whitelisting it
// handed the renderer a way to re-point all of them at an arbitrary directory
// while bypassing game:set-path's "is this actually a HumanitZ install" checks.
// game:set-path is the single validating entry point; the renderer already uses
// only that.
export const ALLOWED_SETTINGS_KEYS = new Set([
  'themeId', 'darkMode', 'minimizeToTray',
  'nexusApiKey', 'ue4ssVersion', 'windowState',
  'profiles', 'activeProfileId',
  'nexusInstalledMods',
  'skipInstallPreview',
  'uiZoom',
])

function registerSettingsIpc() {
  ipcMain.handle('settings:get', (_, key, defaultValue) => {
    return configStore.get(key, defaultValue)
  })

  ipcMain.handle('settings:set', (_, key, value) => {
    if (!ALLOWED_SETTINGS_KEYS.has(key)) {
      throw new Error(`Setting key not allowed: ${key}`)
    }
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
        { name: 'Mod Files', extensions: ['zip', 'rar', '7z', 'pak'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('shell:open-external', (_, url) => {
    // Shared with setWindowOpenHandler in index.js — see services/external-link.
    openExternalSafe(url)
  })

  ipcMain.handle('shell:open-path', (_, filePath) => {
    if (typeof filePath !== 'string') return

    // Restrict to game directory or app config directory
    const resolved = path.resolve(filePath)
    const gamePath = configStore.get('gamePath')
    const configDir = configStore.getConfigDir()
    const allowed = [gamePath, configDir].filter(Boolean).map(p => path.resolve(p))
    const isAllowed = allowed.some(dir => resolved === dir || resolved.startsWith(dir + path.sep))
    if (!isAllowed) return

    // openPath uses the OS default association, which EXECUTES .exe/.bat/etc.
    // A malicious mod can drop such a file under the game dir, so reveal those
    // in the folder instead of running them. (Mirrors mods-config's open-path.)
    if (isExecutableExt(resolved)) {
      shell.showItemInFolder(resolved)
      return ''
    }
    // Returns an error string on failure, empty string on success.
    return shell.openPath(resolved)
  })
}

export { registerSettingsIpc }
