import { ipcMain } from 'electron'
import { browseWorkshop } from './steam-workshop-client.js'

// Only ever invoked from the dev-only Steam Workshop tab. Errors are returned
// as { ok: false, error } so the renderer can show a retry state.
export function registerSteamWorkshopIpc() {
  ipcMain.handle('steam:browse', async (_e, opts) => {
    const page = (opts && opts.page) || 1
    try {
      return await browseWorkshop(opts || {})
    } catch (err) {
      return { ok: false, items: [], page, hasNext: false, error: String(err?.message || err) }
    }
  })
}
