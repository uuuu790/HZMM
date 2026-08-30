// nxm:// protocol handler — the Nexus website's "Mod Manager Download" button.
//
// An nxm link (nxm://humanitz/mods/123/files/456?key=..&expires=..&user_id=..)
// carries a short-lived signed token that makes the V1 download_link endpoint
// work for FREE accounts (the plain endpoint is Premium-only). Registering as
// the OS handler for nxm: is therefore the one-click install path for
// non-Premium users.
//
// nxm: is a GLOBAL protocol shared by every Nexus game — taking it over also
// takes it from Vortex / MO2. Registration is opt-in (Settings toggle, default
// OFF); links for other games get a "wrong game" toast and are dropped.

import { app, ipcMain } from 'electron'
import path from 'path'
import configStore from '../services/config-store.js'
import logger from '../services/logger.js'
import { resolveNexusDownloadUrl, downloadAndInstallResolvedFile } from './mods-download.js'
import { recordInstall, flattenLandedMods } from './nexus-install-tracker.js'
import { runUpdateWithStateRestore } from './mods-update-flow.js'
import { GAME_DOMAIN } from './nexus-v2-client.js'

// Parse + validate an nxm:// URL. Returns null unless every part is
// well-formed: nxm://{game}/mods/{modId}/files/{fileId}[?key=..&expires=..].
// key/expires are length-bounded and character-restricted here, BEFORE they
// are ever echoed into an API query string.
export function parseNxmUrl(urlStr) {
  if (typeof urlStr !== 'string' || urlStr.length > 2048) return null
  let u
  try { u = new URL(urlStr) } catch { return null }
  if (u.protocol !== 'nxm:') return null
  const game = u.hostname.toLowerCase()
  if (!/^[a-z0-9]+$/.test(game)) return null
  const m = u.pathname.match(/^\/mods\/(\d{1,10})\/files\/(\d{1,10})\/?$/)
  if (!m) return null
  const modId = parseInt(m[1], 10)
  const fileId = parseInt(m[2], 10)
  if (!Number.isInteger(modId) || modId <= 0) return null
  if (!Number.isInteger(fileId) || fileId <= 0) return null
  const rawKey = u.searchParams.get('key')
  const rawExpires = u.searchParams.get('expires')
  const key = rawKey && /^[\w-]{1,256}$/.test(rawKey) ? rawKey : null
  const expires = rawExpires && /^\d{1,20}$/.test(rawExpires) ? rawExpires : null
  return { game, modId, fileId, key, expires }
}

// First nxm:// string in an argv array (cold start / second-instance both
// deliver the clicked link as a plain argument on Windows).
export function findNxmUrlInArgv(argv) {
  return (Array.isArray(argv) ? argv : []).find(a => typeof a === 'string' && a.startsWith('nxm://')) || null
}

// In dev, electron.exe needs the app path replayed as an argument when the OS
// relaunches us for a protocol link; the packaged portable exe does not.
function protocolArgs() {
  return app.isPackaged ? [] : [path.resolve(process.argv[1])]
}

export function registerNxmProtocol() {
  return app.setAsDefaultProtocolClient('nxm', process.execPath, protocolArgs())
}

export function unregisterNxmProtocol() {
  return app.removeAsDefaultProtocolClient('nxm', process.execPath, protocolArgs())
}

function isNxmProtocolClient() {
  return app.isDefaultProtocolClient('nxm', process.execPath, protocolArgs())
}

// Re-assert the registration on startup when the user opted in — the registry
// entry points at an absolute exe path, and the PORTABLE exe may have moved
// since it was written (mirrors the auto-start re-registration in index.js).
export function ensureNxmRegistration() {
  if (configStore.get('nxmHandlerEnabled', false)) {
    if (!registerNxmProtocol()) logger.warn('nxm: protocol re-registration failed')
  }
}

// Window-scoped: re-bound on every createWindow so a window rebuilt from the
// tray keeps receiving nxm toasts (the IPC registration below is one-time).
let windowRef = null

export function initNxmHandler(mainWindow) {
  windowRef = mainWindow
}

function send(channel, payload) {
  if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send(channel, payload)
}

const nxmInFlight = new Set()

// Entry point for both launch paths: cold start (own argv, deferred until the
// renderer loaded) and second-instance (commandLine argv).
export async function handleNxmUrl(urlStr) {
  const parsed = parseNxmUrl(urlStr)
  if (!parsed) {
    logger.warn('nxm: dropped malformed link')
    return
  }
  // The OS can still deliver links while the toggle is off (e.g. the registry
  // entry survived a config reset) — respect the setting, not the registry.
  if (!configStore.get('nxmHandlerEnabled', false)) {
    logger.warn('nxm: link received while handler disabled — ignored')
    return
  }
  if (parsed.game !== GAME_DOMAIN) {
    logger.info(`nxm: link for other game "${parsed.game}" — ignored`)
    send('nxm:wrong-game', { game: parsed.game })
    return
  }
  const apiKey = configStore.get('nexusApiKey')
  if (!apiKey) {
    send('nxm:install-failed', { modId: parsed.modId, error: 'NEXUS_API_KEY_REQUIRED' })
    return
  }
  const lockKey = `${parsed.modId}:${parsed.fileId}`
  if (nxmInFlight.has(lockKey)) return
  nxmInFlight.add(lockKey)
  send('nxm:install-started', { modId: parsed.modId, fileId: parsed.fileId })
  try {
    const resolved = await resolveNexusDownloadUrl(
      { game: parsed.game, modId: parsed.modId, fileId: parsed.fileId, key: parsed.key, expires: parsed.expires },
      apiKey
    )
    // Route through the shared snapshot/restore + version-retention wrapper
    // (same as nexus:update-file): when the incoming file replaces a tracked
    // receipt this is the free-account update path — enabled-state, edited
    // configs, load-order prefixes and rollback behave exactly like the
    // Premium one-click update. For an untracked mod (or a fresh variant of a
    // tracked one) the wrapper finds no receipt and degrades to a plain
    // install. recordInstall runs INSIDE the install step (mirrors
    // performInstallFile) so the restore step's receipt migration (load-order
    // prefix rename) covers the fresh receipt too — recording after restore
    // would overwrite the migrated name.
    const install = async () => {
      const r = await downloadAndInstallResolvedFile(resolved, { modId: parsed.modId, fileId: parsed.fileId }, windowRef)
      // Best-effort: the files already landed — a receipt write failure must
      // not fail the install (and must not trip the update wrapper's
      // failed-install snapshot cleanup). The wrapper's receipt retirement
      // no-ops when the new receipt is missing, so nothing is orphaned.
      try {
        recordInstall(parsed.modId, parsed.fileId, flattenLandedMods(r))
      } catch (err) {
        logger.warn(`nxm: receipt record failed: ${err.message}`)
      }
      return r
    }
    const { result, wasUpdate } = await runUpdateWithStateRestore(parsed.modId, parsed.fileId, install)
    const landed = flattenLandedMods(result)
    logger.info(`nxm: ${wasUpdate ? 'updated' : 'installed'} mod ${parsed.modId} file ${parsed.fileId}`)
    send('nxm:install-done', { modId: parsed.modId, fileId: parsed.fileId, mods: landed, updated: wasUpdate })
  } catch (err) {
    // Resolver/downloader errors are already host-only (no token leakage).
    logger.warn(`nxm: install failed for ${lockKey}: ${err.message}`)
    send('nxm:install-failed', { modId: parsed.modId, error: err.message })
  } finally {
    nxmInFlight.delete(lockKey)
  }
}

export function registerNxmIpc() {
  ipcMain.handle('nxm:get-status', () => ({
    enabled: !!configStore.get('nxmHandlerEnabled', false),
    isDefault: isNxmProtocolClient(),
  }))

  // Dedicated handler, NOT the settings:set whitelist: flipping this touches
  // OS state (protocol registration), so it goes through explicit IPC the same
  // way gamePath only goes through the validating game:set-path.
  ipcMain.handle('nxm:set-enabled', (_, enabled) => {
    const on = !!enabled
    if (on) {
      if (!registerNxmProtocol()) {
        return { enabled: false, isDefault: isNxmProtocolClient(), error: 'register-failed' }
      }
    } else {
      unregisterNxmProtocol()
    }
    configStore.set('nxmHandlerEnabled', on)
    logger.info(`nxm: handler ${on ? 'enabled' : 'disabled'}`)
    return { enabled: on, isDefault: isNxmProtocolClient() }
  })
}
