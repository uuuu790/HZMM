import { ipcMain, dialog, shell, type FileFilter, type IpcMainInvokeEvent } from 'electron'
import path from 'path'
import configStore from '../services/config-store'
import logger from '../services/logger'
import { isExecutableExt } from '../services/path-safety'
import { mainText } from '../services/main-text'
import { currentLocale } from './locale'
import type { SettingsKey } from './types'

// NOTE: several keys were removed after being confirmed unread across main +
// renderer: `language` (now `lang` via locale:set-preference), `theme`
// (superseded by `themeId`), `autoCheckUpdate`, `modSortOrder`,
// `modSortDirection`, and `lastTab`. Keeping the whitelist tight stops the
// renderer writing dead keys to the config file.
// Exported so unit tests can verify the whitelist directly without spinning
// up Electron / the IPC handler.
// NOTE: `gamePath` is intentionally NOT here. It is the trust anchor every
// filesystem path is built from (extraction roots, rm/rename targets, the
// shell:open-path allow-list) and it must only be written through the
// validating `game:set-path` handler, which confirms the folder is a real
// game install and rejects UNC/network paths. Allowing it via the generic
// `settings:set` would let a compromised renderer point the whole app at an
// arbitrary (or remote) directory. game.ts writes it via configStore directly.
export const ALLOWED_SETTINGS_KEYS: ReadonlySet<string> = new Set<SettingsKey>([
  'themeId', 'darkMode', 'minimizeToTray',
  'nexusApiKey', 'ue4ssVersion', 'windowState',
  'profiles', 'activeProfileId',
  'nexusInstalledMods',
  'skipInstallPreview',
  'uiZoom',
])

// mailto: hands the address to the OS mail client. Accept only address(es)
// plus the standard header fields: some mail clients honour extras such as
// attach=<local file>, and a hash or path-like part has no place in a mailto.
const MAILTO_FIELDS = new Set(['subject', 'body', 'cc', 'bcc'])
const MAILTO_ADDRESS = /^[^\s\p{Cc}@\\/<>"]+@[^\s\p{Cc}@\\/<>"]+$/u

function isPlainMailto(u: URL): boolean {
  if (u.hash) return false
  let to: string
  try { to = decodeURIComponent(u.pathname) } catch { return false }
  if (!to.split(',').every(a => MAILTO_ADDRESS.test(a.trim()))) return false
  return [...u.searchParams.keys()].every(k => MAILTO_FIELDS.has(k.toLowerCase()))
}

function registerSettingsIpc(): void {
  // Read-only and unrestricted, as before: the renderer passes setting names
  // (configStore.get resolves any other key to the default).
  ipcMain.handle('settings:get', (_: IpcMainInvokeEvent, key: unknown, defaultValue: unknown) => {
    return configStore.get(key as string, defaultValue)
  })

  ipcMain.handle('settings:set', (_: IpcMainInvokeEvent, key: unknown, value: unknown) => {
    if (typeof key !== 'string' || !ALLOWED_SETTINGS_KEYS.has(key)) {
      throw new Error(`Setting key not allowed: ${key}`)
    }
    configStore.set(key, value)
  })

  ipcMain.handle('dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:select-files', async (_: IpcMainInvokeEvent, filters?: FileFilter[] | null) => {
    const text = mainText(currentLocale())
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: filters || [
        { name: text.modFiles, extensions: ['zip', 'rar', '7z', 'pak'] },
        { name: text.allFiles, extensions: ['*'] }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('shell:open-external', (_: IpcMainInvokeEvent, url: unknown) => {
    if (typeof url !== 'string') return
    try {
      const parsed = new URL(url)
      const web = parsed.protocol === 'https:' || parsed.protocol === 'http:'
      if (!web && !(parsed.protocol === 'mailto:' && isPlainMailto(parsed))) return
    } catch {
      return
    }
    // openExternal rejects when the shell has no working handler; that must
    // not become an unhandled rejection in main.
    return shell.openExternal(url).catch((err: Error) => {
      logger.warn(`openExternal failed: ${err.message}`)
    })
  })

  ipcMain.handle('shell:open-path', (_: IpcMainInvokeEvent, filePath: unknown) => {
    if (typeof filePath !== 'string') return

    // Restrict to game directory or app config directory
    const resolved = path.resolve(filePath)
    const gamePath = configStore.get('gamePath')
    const configDir = configStore.getConfigDir()
    const allowed = [gamePath, configDir].filter((p): p is string => Boolean(p)).map(p => path.resolve(p))
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
