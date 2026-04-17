import { ipcMain } from 'electron'
import https from 'https'
import configStore from '../services/config-store.js'
import logger from '../services/logger.js'
import { nexusApiRequest, resolveNexusDownloadUrl, downloadAndInstallFromUrl } from './mods-download.js'
import { installMods } from './mods-install.js'
import { downloadFile } from '../services/archive.js'
import fs from 'fs'
import path from 'path'

// V1 (REST) vs V2 (GraphQL) split.
// - V2 is used for anything public-read: mod listings, search, detail, files.
//   No auth required, way richer data, and — critically — returns the full
//   catalogue instead of V1's hardcoded 10-per-endpoint cap.
// - V1 is kept for the bits V2 doesn't expose: account validation (to check
//   `is_premium`) and `download_link.json` (Premium-only, resolves the
//   temporary CDN URL we actually download from).

const GAME_DOMAIN = 'humanitz'
const GAME_ID = 5743            // HumanitZ — probed via V2 `game(domainName:)`; cached.
const DEFAULT_BROWSE_COUNT = 100

// ============================================================
// V2 GraphQL client
// ============================================================
function gqlRequest(query, variables) {
  const body = JSON.stringify({ query, variables })
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.nexusmods.com',
      path: '/v2/graphql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': `HZMM/${process.env.npm_package_version || 'dev'}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`V2 HTTP ${res.statusCode}: ${data.slice(0, 200)}`))
        }
        try {
          const parsed = JSON.parse(data)
          if (parsed.errors) {
            return reject(new Error(`V2 GraphQL: ${parsed.errors[0]?.message || 'unknown'}`))
          }
          resolve(parsed.data)
        } catch (e) {
          reject(new Error(`V2 parse error: ${e.message}`))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// Shared fragment used everywhere we return a mod card.
const MOD_CARD_FIELDS = `
  modId
  name
  summary
  author
  version
  pictureUrl
  thumbnailUrl
  endorsements
  downloads
  adultContent
  updatedAt
  createdAt
  modCategory { name }
`

// ============================================================
// In-memory cache (Nexus is generous on V2 but we still dedupe).
// ============================================================
const cache = new Map()
const CACHE_TTL = {
  list: 10 * 60 * 1000,
  detail: 60 * 60 * 1000,
  files: 30 * 60 * 1000,
  validate: 5 * 60 * 1000,
  // Search results expire fast — users iterate on queries quickly.
  search: 2 * 60 * 1000,
}

function cacheGet(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() > hit.expires) { cache.delete(key); return null }
  return hit.data
}
function cacheSet(key, data, ttl) { cache.set(key, { data, expires: Date.now() + ttl }) }
function cacheClear(prefix) {
  if (!prefix) { cache.clear(); return }
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key)
}

// ============================================================
// V2 query builders
// ============================================================
// Map HZMM's UI sort option to a V2 ModsSort input.
// Valid sort keys (probed from schema): relevance, name, downloads,
// uniqueDownloads, endorsements, random, createdAt, updatedAt, size, lastComment.
const SORT_MAP = {
  trending: { endorsements: { direction: 'DESC' } },
  latest_updated: { updatedAt: { direction: 'DESC' } },
  latest_added: { createdAt: { direction: 'DESC' } },
  most_downloaded: { downloads: { direction: 'DESC' } },
  relevance: { relevance: { direction: 'DESC' } },
}

async function v2ListMods({ sort, count = DEFAULT_BROWSE_COUNT, offset = 0 }) {
  const sortInput = SORT_MAP[sort] || SORT_MAP.trending
  const data = await gqlRequest(
    `query ListMods($filter: ModsFilter, $sort: [ModsSort!], $count: Int, $offset: Int) {
      mods(filter: $filter, sort: $sort, count: $count, offset: $offset) {
        totalCount
        nodes { ${MOD_CARD_FIELDS} }
      }
    }`,
    {
      filter: { gameDomainName: { value: GAME_DOMAIN } },
      sort: [sortInput],
      count,
      offset,
    }
  )
  return data.mods
}

async function v2SearchMods({ keyword, count = DEFAULT_BROWSE_COUNT }) {
  // nameStemmed does fuzzy / stemmed substring match across the catalogue.
  // Relevance sort is the natural ordering for keyword results.
  const data = await gqlRequest(
    `query SearchMods($filter: ModsFilter, $sort: [ModsSort!], $count: Int) {
      mods(filter: $filter, sort: $sort, count: $count) {
        totalCount
        nodes { ${MOD_CARD_FIELDS} }
      }
    }`,
    {
      filter: {
        gameDomainName: { value: GAME_DOMAIN },
        nameStemmed: { value: keyword },
      },
      sort: [SORT_MAP.relevance],
      count,
    }
  )
  return data.mods
}

async function v2GetMod(modId) {
  const data = await gqlRequest(
    `query ModDetail($modId: ID!, $gameId: ID!) {
      mod(modId: $modId, gameId: $gameId) {
        modId
        name
        summary
        description
        author
        version
        pictureUrl
        thumbnailUrl
        thumbnailLargeUrl
        endorsements
        downloads
        fileSize
        adultContent
        updatedAt
        createdAt
        modCategory { name }
        uploader { name memberId }
      }
    }`,
    { modId, gameId: GAME_ID }
  )
  return data.mod
}

async function v2GetModFiles(modId) {
  const data = await gqlRequest(
    `query ModFiles($modId: ID!, $gameId: ID!) {
      modFiles(modId: $modId, gameId: $gameId) {
        fileId
        name
        version
        description
        categoryId
        category
        primary
        size
        sizeInBytes
        date
        uri
        totalDownloads
        uniqueDownloads
      }
    }`,
    { modId, gameId: GAME_ID }
  )
  // Normalize to the snake_case shape the renderer already expects.
  return (data.modFiles || []).map(f => ({
    file_id: f.fileId,
    name: f.name,
    version: f.version,
    description: f.description,
    category_id: f.categoryId,
    category_name: f.category,
    is_primary: !!f.primary,
    size: f.size,                          // KB, matches V1
    size_in_bytes: Number(f.sizeInBytes),  // GraphQL BigInt arrives as string
    uploaded_timestamp: f.date,
    file_name: f.uri,
    total_downloads: f.totalDownloads,
    unique_downloads: f.uniqueDownloads,
  }))
}

// ============================================================
// IPC registration
// ============================================================
function registerNexusIpc(mainWindow) {
  // V1 — still used to check Premium status (V2 auth is different / not wired).
  ipcMain.handle('nexus:validate', async () => {
    const apiKey = configStore.get('nexusApiKey')
    if (!apiKey) return { ok: false, reason: 'no-key' }
    try {
      const hit = cacheGet('validate')
      const data = hit || await nexusApiRequest('/users/validate.json', apiKey)
      if (!hit) cacheSet('validate', data, CACHE_TTL.validate)
      return { ok: true, premium: !!data?.is_premium, name: data?.name, profileUrl: data?.profile_url }
    } catch (err) {
      const msg = String(err?.message || err)
      if (msg.includes('401') || msg.toLowerCase().includes('invalid')) return { ok: false, reason: 'invalid' }
      return { ok: false, reason: 'network', error: msg }
    }
  })

  // V2 — list mods by sort category. No API key required.
  ipcMain.handle('nexus:list-mods', async (_, sort) => {
    try {
      const key = `list:${sort || 'trending'}`
      const hit = cacheGet(key)
      if (hit) return { ok: true, ...hit }
      const page = await v2ListMods({ sort })
      const payload = { mods: page.nodes, totalCount: page.totalCount }
      cacheSet(key, payload, CACHE_TTL.list)
      return { ok: true, ...payload }
    } catch (err) {
      logger.warn(`V2 list mods failed: ${err.message}`)
      return { ok: false, reason: 'network', error: err.message }
    }
  })

  // V2 — real keyword search. Nexus stems the query server-side.
  ipcMain.handle('nexus:search-mods', async (_, keyword) => {
    if (!keyword || typeof keyword !== 'string' || !keyword.trim()) {
      return { ok: true, mods: [], totalCount: 0 }
    }
    const q = keyword.trim().slice(0, 100)
    try {
      const key = `search:${q.toLowerCase()}`
      const hit = cacheGet(key)
      if (hit) return { ok: true, ...hit }
      const page = await v2SearchMods({ keyword: q })
      const payload = { mods: page.nodes, totalCount: page.totalCount }
      cacheSet(key, payload, CACHE_TTL.search)
      return { ok: true, ...payload }
    } catch (err) {
      logger.warn(`V2 search failed: ${err.message}`)
      return { ok: false, reason: 'network', error: err.message }
    }
  })

  // V2 — single mod detail (used by NexusModDetailModal).
  ipcMain.handle('nexus:get-mod-detail', async (_, modId) => {
    if (!Number.isInteger(modId) || modId <= 0) return { ok: false, reason: 'invalid-id' }
    try {
      const key = `detail:${modId}`
      const hit = cacheGet(key)
      if (hit) return { ok: true, mod: hit }
      const mod = await v2GetMod(modId)
      if (!mod) return { ok: false, reason: 'not-found' }
      cacheSet(key, mod, CACHE_TTL.detail)
      return { ok: true, mod }
    } catch (err) {
      logger.warn(`V2 mod detail ${modId} failed: ${err.message}`)
      return { ok: false, reason: 'network', error: err.message }
    }
  })

  // V2 — files for a mod.
  ipcMain.handle('nexus:get-mod-files', async (_, modId) => {
    if (!Number.isInteger(modId) || modId <= 0) return { ok: false, reason: 'invalid-id' }
    try {
      const key = `files:${modId}`
      const hit = cacheGet(key)
      if (hit) return { ok: true, files: hit }
      const files = await v2GetModFiles(modId)
      cacheSet(key, files, CACHE_TTL.files)
      return { ok: true, files }
    } catch (err) {
      logger.warn(`V2 mod files ${modId} failed: ${err.message}`)
      return { ok: false, reason: 'network', error: err.message }
    }
  })

  // V1 (kept) — install the latest main file for a mod.
  ipcMain.handle('nexus:install-mod', (_, modId) => {
    if (!Number.isInteger(modId) || modId <= 0) throw new Error('Invalid mod id')
    const url = `https://www.nexusmods.com/${GAME_DOMAIN}/mods/${modId}`
    return downloadAndInstallFromUrl(url, mainWindow)
  })

  // V1 (kept) — install a specific file. Uses the V1 download_link endpoint,
  // which is the Premium-only bit that V2 doesn't expose.
  ipcMain.handle('nexus:install-file', async (_, modId, fileId) => {
    if (!Number.isInteger(modId) || modId <= 0) throw new Error('Invalid mod id')
    if (!Number.isInteger(fileId) || fileId <= 0) throw new Error('Invalid file id')
    const apiKey = configStore.get('nexusApiKey')
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

  ipcMain.handle('nexus:clear-cache', (_, prefix) => { cacheClear(prefix); return { ok: true } })
}

export { registerNexusIpc }
