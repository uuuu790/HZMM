import { ipcMain } from 'electron'
import configStore from '../services/config-store.js'
import logger from '../services/logger.js'
import { nexusApiRequest, resolveNexusDownloadUrl, downloadAndInstallFromUrl } from './mods-download.js'
import { installMods } from './mods-install.js'
import { downloadFile } from '../services/archive.js'
import fs from 'fs'
import path from 'path'

const GAME_DOMAIN = 'humanitz'

// Cache layer — Nexus v1 API rate-limits at 2500/day for free, ~10x for Premium.
// We cache aggressively so routine tab-switching doesn't eat quota.
const cache = new Map() // key → { data, expires }
const CACHE_TTL = {
  validate: 5 * 60 * 1000,      // 5 min
  list: 10 * 60 * 1000,         // 10 min (trending shifts slowly)
  detail: 60 * 60 * 1000,       // 1 hour
  files: 30 * 60 * 1000,        // 30 min
}

function cacheGet(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() > hit.expires) { cache.delete(key); return null }
  return hit.data
}
function cacheSet(key, data, ttl) {
  cache.set(key, { data, expires: Date.now() + ttl })
}
function cacheClear(prefix) {
  if (!prefix) { cache.clear(); return }
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key)
}

async function cachedApiGet(endpoint, apiKey, ttl, cacheKey) {
  const key = cacheKey || endpoint
  const hit = cacheGet(key)
  if (hit) return hit
  const data = await nexusApiRequest(endpoint, apiKey)
  cacheSet(key, data, ttl)
  return data
}

function getApiKey() {
  return configStore.get('nexusApiKey')
}

function registerNexusIpc(mainWindow) {
  // Validate API key + check Premium status.
  // Result: { ok: true, premium, name, profileUrl } on success,
  //         { ok: false, reason: 'no-key' | 'invalid' | 'network' | 'not-premium' }
  ipcMain.handle('nexus:validate', async () => {
    const apiKey = getApiKey()
    if (!apiKey) return { ok: false, reason: 'no-key' }
    try {
      const data = await cachedApiGet('/users/validate.json', apiKey, CACHE_TTL.validate, 'validate')
      const premium = !!data?.is_premium
      if (!premium) {
        return { ok: false, reason: 'not-premium', name: data?.name, profileUrl: data?.profile_url }
      }
      return { ok: true, premium: true, name: data?.name, profileUrl: data?.profile_url }
    } catch (err) {
      const msg = String(err?.message || err)
      if (msg.includes('401') || msg.toLowerCase().includes('invalid')) {
        return { ok: false, reason: 'invalid' }
      }
      logger.warn(`Nexus validate failed: ${msg}`)
      return { ok: false, reason: 'network', error: msg }
    }
  })

  // List mods by category: 'trending' | 'latest_updated' | 'latest_added'
  ipcMain.handle('nexus:list-mods', async (_, category) => {
    const allowed = new Set(['trending', 'latest_updated', 'latest_added'])
    if (!allowed.has(category)) category = 'trending'
    const apiKey = getApiKey()
    if (!apiKey) return { ok: false, reason: 'no-key' }
    try {
      const data = await cachedApiGet(
        `/games/${GAME_DOMAIN}/mods/${category}.json`,
        apiKey,
        CACHE_TTL.list,
        `list:${category}`
      )
      return { ok: true, mods: Array.isArray(data) ? data : [] }
    } catch (err) {
      logger.warn(`Nexus list ${category} failed: ${err.message}`)
      return { ok: false, reason: 'network', error: err.message }
    }
  })

  // Fetch full mod details (description, stats, author, etc.)
  ipcMain.handle('nexus:get-mod-detail', async (_, modId) => {
    if (!Number.isInteger(modId) || modId <= 0) return { ok: false, reason: 'invalid-id' }
    const apiKey = getApiKey()
    if (!apiKey) return { ok: false, reason: 'no-key' }
    try {
      const data = await cachedApiGet(
        `/games/${GAME_DOMAIN}/mods/${modId}.json`,
        apiKey,
        CACHE_TTL.detail,
        `detail:${modId}`
      )
      return { ok: true, mod: data }
    } catch (err) {
      logger.warn(`Nexus detail ${modId} failed: ${err.message}`)
      return { ok: false, reason: 'network', error: err.message }
    }
  })

  // Fetch files list for a mod
  ipcMain.handle('nexus:get-mod-files', async (_, modId) => {
    if (!Number.isInteger(modId) || modId <= 0) return { ok: false, reason: 'invalid-id' }
    const apiKey = getApiKey()
    if (!apiKey) return { ok: false, reason: 'no-key' }
    try {
      const data = await cachedApiGet(
        `/games/${GAME_DOMAIN}/mods/${modId}/files.json`,
        apiKey,
        CACHE_TTL.files,
        `files:${modId}`
      )
      return { ok: true, files: data?.files || [], updates: data?.file_updates || [] }
    } catch (err) {
      logger.warn(`Nexus files ${modId} failed: ${err.message}`)
      return { ok: false, reason: 'network', error: err.message }
    }
  })

  // Install mod by id — picks the latest main file. Thin wrapper over the
  // existing URL-based install pipeline.
  ipcMain.handle('nexus:install-mod', (_, modId) => {
    if (!Number.isInteger(modId) || modId <= 0) throw new Error('Invalid mod id')
    const url = `https://www.nexusmods.com/${GAME_DOMAIN}/mods/${modId}`
    return downloadAndInstallFromUrl(url, mainWindow)
  })

  // Install a specific file — used from the detail modal's file list.
  ipcMain.handle('nexus:install-file', async (_, modId, fileId) => {
    if (!Number.isInteger(modId) || modId <= 0) throw new Error('Invalid mod id')
    if (!Number.isInteger(fileId) || fileId <= 0) throw new Error('Invalid file id')
    const apiKey = getApiKey()
    if (!apiKey) throw new Error('NEXUS_API_KEY_REQUIRED')

    const resolved = await resolveNexusDownloadUrl({ game: GAME_DOMAIN, modId, fileId }, apiKey)
    const urlObj = new URL(resolved.url)
    let filename = path.basename(urlObj.pathname)
    if (!filename || !filename.match(/\.(zip|rar|pak)$/i)) {
      filename = `${resolved.name || `nexus_mod_${modId}_${fileId}`}.zip`
    }
    const tempPath = path.join(configStore.getConfigDir(), 'temp', filename)
    fs.mkdirSync(path.dirname(tempPath), { recursive: true })

    try {
      await downloadFile(resolved.url, tempPath, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('mods:download-progress', progress)
        }
      })
      const result = await installMods([tempPath], mainWindow)
      try { fs.unlinkSync(tempPath) } catch { /* temp file already gone */ }
      return result
    } catch (err) {
      try { fs.unlinkSync(tempPath) } catch { /* temp file already gone */ }
      throw err
    }
  })

  // Manual cache refresh hook (synchronous — no I/O involved)
  ipcMain.handle('nexus:clear-cache', (_, prefix) => { cacheClear(prefix); return { ok: true } })
}

export { registerNexusIpc }
