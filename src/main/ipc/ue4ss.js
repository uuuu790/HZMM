import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import logger from '../services/logger.js'
import { getLatestRelease, downloadRelease } from '../services/github-release.js'
import { extractZipRaw } from '../services/archive.js'
import { resolveWithin } from '../services/path-safety.js'
import { serializeModWrite } from './mods-install.js'

// UE4SS ships different proxy DLLs depending on engine version. Single source
// of truth: status detection accepts any of them, and rotateUe4ssToBackup must
// rotate ALL of them — rotating only dwmapi.dll on an xinput-based install
// leaves the old proxy loader in Win64 next to the freshly-extracted dwmapi.dll,
// so two loaders fight over the process.
const PROXY_DLLS = ['dwmapi.dll', 'xinput1_3.dll', 'd3d11.dll', 'dsound.dll']

function getBinariesPath() {
  const gamePath = configStore.get('gamePath')
  if (!gamePath) return null

  // HumanitZ: gamePath/HumanitZ/Binaries/Win64/
  const candidates = [
    path.join(gamePath, 'HumanitZ', 'Binaries', 'Win64'),
    path.join(gamePath, 'Binaries', 'Win64')
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function checkUe4ssStatus() {
  const binPath = getBinariesPath()
  if (!binPath) return { status: 'uninstalled', version: null }

  // experimental-latest: <proxy>.dll in Win64, UE4SS.dll in Win64/ue4ss/
  // 3.0.1: 全部在 Win64/
  const hasNewStructure = fs.existsSync(path.join(binPath, 'ue4ss', 'UE4SS.dll'))
  const hasOldStructure = fs.existsSync(path.join(binPath, 'UE4SS.dll'))
  const hasProxy = PROXY_DLLS.some(name => fs.existsSync(path.join(binPath, name)))

  if (!hasProxy && !hasNewStructure && !hasOldStructure) {
    return { status: 'uninstalled', version: null }
  }

  const installedVersion = configStore.get('ue4ssVersion', null)
  // published_at of the release we installed. Older HZMM builds didn't record
  // it, so this may be null — the status handler treats a missing value as
  // "up-to-date" rather than nagging (see ue4ss:status).
  const installedPublishedAt = configStore.get('ue4ssPublishedAt', null)
  const structure = hasNewStructure ? 'experimental' : 'legacy'
  return { status: 'installed', version: installedVersion, publishedAt: installedPublishedAt, structure }
}

// Move (not delete) the existing UE4SS core files into backupDir so a failed
// extract can roll back to a working install instead of a half-deleted mess.
// Mirrors the old "keep the user's Mods folder" rule. Backup lives next to the
// install (same volume) so renameSync never hits EXDEV. Returns moved {from,to}.
function rotateUe4ssToBackup(binPath, backupDir) {
  const moved = []
  const stash = (from, key) => {
    const to = path.join(backupDir, key)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.renameSync(from, to)
    moved.push({ from, to })
  }
  // Every proxy DLL, not just dwmapi.dll — see PROXY_DLLS above.
  const knownFiles = [...PROXY_DLLS, 'UE4SS.dll', 'UE4SS-settings.ini']
  for (const file of knownFiles) {
    const filePath = path.join(binPath, file)
    if (fs.existsSync(filePath)) stash(filePath, file)
  }
  // experimental structure: ue4ss/ subdir — rotate everything except the
  // user's Mods folder.
  const ue4ssSubDir = path.join(binPath, 'ue4ss')
  if (fs.existsSync(ue4ssSubDir)) {
    for (const entry of fs.readdirSync(ue4ssSubDir)) {
      if (entry === 'Mods') continue
      stash(path.join(ue4ssSubDir, entry), path.join('ue4ss', entry))
    }
  }
  return moved
}

// Put rotated core files back after a failed extract.
function restoreUe4ssBackup(moved) {
  for (const { from, to } of moved) {
    try {
      if (fs.existsSync(from)) {
        if (fs.statSync(from).isDirectory()) fs.rmSync(from, { recursive: true, force: true })
        else fs.unlinkSync(from)
      }
      fs.mkdirSync(path.dirname(from), { recursive: true })
      fs.renameSync(to, from)
    } catch (err) {
      logger.warn(`UE4SS rollback failed for ${from}: ${err.message}`)
    }
  }
}

// User-owned files that live INSIDE the UE4SS install tree and would otherwise
// be clobbered by extracting the release zip over it. Each appears in one of
// two places depending on the install layout (legacy flat vs experimental
// ue4ss/ subdir), so both are listed.
//
//   - UE4SS-settings.ini: user-editable (graphics API, console toggles, keybinds)
//   - Mods/mods.txt + Mods/mods.json: the mod enable/disable registry HZMM
//     itself maintains. rotateUe4ssToBackup deliberately skips the Mods folder
//     to preserve the user's mods — but the release zip ships its own default
//     Mods/mods.txt and Mods/mods.json, so without snapshotting them here the
//     extract silently resets every mod's enabled state.
const UE4SS_PRESERVED_RELATIVE_PATHS = [
  'UE4SS-settings.ini',
  path.join('ue4ss', 'UE4SS-settings.ini'),
  path.join('Mods', 'mods.txt'),
  path.join('Mods', 'mods.json'),
  path.join('ue4ss', 'Mods', 'mods.txt'),
  path.join('ue4ss', 'Mods', 'mods.json'),
]

function snapshotUserFiles(installPath) {
  const saved = []
  for (const rel of UE4SS_PRESERVED_RELATIVE_PATHS) {
    const full = path.join(installPath, rel)
    if (fs.existsSync(full)) {
      // Keep installPath + the relative path (not just the absolute target) so
      // restoreUserFiles can re-derive the write target under resolveWithin
      // rather than trusting a stored absolute path.
      try { saved.push({ installPath, rel, content: fs.readFileSync(full) }) } catch { /* unreadable */ }
    }
  }
  return saved
}

function restoreUserFiles(saved) {
  for (const { installPath, rel, content } of saved) {
    try {
      // Re-resolve the write target under the path guard. The rel paths come
      // from UE4SS_PRESERVED_RELATIVE_PATHS (not renderer input), so this is
      // defense-in-depth: it keeps the "writes stay inside installPath"
      // invariant explicit and refactor-proof rather than trusting a stored
      // absolute path.
      const full = resolveWithin(installPath, rel)
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, content)
      logger.info(`Preserved user file: ${rel}`)
    } catch (err) {
      logger.warn(`Failed to restore ${rel}: ${err.message}`)
    }
  }
}

async function doInstall(mainWindow) {
  const installPath = getBinariesPath()
  if (!installPath) throw new Error('GAME_PATH_NOT_FOUND')

  const release = await getLatestRelease()
  if (!release.downloadUrl) throw new Error('No download URL found')

  // Unique per call: the download runs OUTSIDE the write mutex (see below), so
  // two overlapping deploys would otherwise stream into the same temp file.
  const tempDir = configStore.getConfigDir()
  const tempZip = path.join(tempDir, `ue4ss_temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`)

  try {
    // Download with progress. Deliberately outside serializeModWrite — holding
    // the shared mod-write mutex across a multi-MB download would block every
    // mod toggle/install for the duration.
    await downloadRelease(release.downloadUrl, tempZip, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ue4ss:progress', progress)
      }
    })

    // The on-disk phase joins the SAME write chain as install/toggle/remove.
    // Without it, UE4SS deploy was the only mod-mutating flow with no
    // reentrancy lock: a second deploy's `fs.rmSync(backupDir)` would delete
    // the first one's in-flight rollback backup, and a concurrent mod install
    // could interleave on the Mods folder mid-extract.
    return await serializeModWrite(async () => {
      // Capture user-owned files BEFORE rotate + extract: UE4SS-settings.ini
      // and the Mods/mods.txt + Mods/mods.json enable-state registry. The
      // release zip ships its own copies of all of them and the extract would
      // otherwise overwrite the user's.
      const savedFiles = snapshotUserFiles(installPath)

      // Rotate old core files aside (keeping the user's Mods) instead of deleting,
      // so a failed extract rolls back to the working install rather than leaving
      // UE4SS half-deleted and unloadable.
      const backupDir = path.join(installPath, '_hzmm_ue4ss_backup')
      fs.rmSync(backupDir, { recursive: true, force: true })
      fs.mkdirSync(backupDir, { recursive: true })
      let rotated = []
      try {
        rotated = rotateUe4ssToBackup(installPath, backupDir)
        // Extract to game directory (不走 mod 分析，直接全部解壓)
        await extractZipRaw(tempZip, installPath)
      } catch (err) {
        restoreUe4ssBackup(rotated)
        throw err
      }
      fs.rmSync(backupDir, { recursive: true, force: true })

      // Put the user's files back, overwriting the freshly-extracted defaults.
      restoreUserFiles(savedFiles)

      // Store version + published_at. The latter is what detects a fresh build
      // of the rolling 'experimental-latest' tag (whose version never changes).
      configStore.set('ue4ssVersion', release.version)
      configStore.set('ue4ssPublishedAt', release.publishedAt || null)

      logger.info(`UE4SS deployed: version ${release.version}`)
      return { version: release.version }
    })
  } finally {
    // Cleanup temp file
    if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip)
  }
}

function registerUe4ssIpc(mainWindow) {
  ipcMain.handle('ue4ss:status', async () => {
    const local = checkUe4ssStatus()

    try {
      const latest = await getLatestRelease()

      if (local.status === 'installed') {
        if (!local.version) {
          // 非透過 HZMM 安裝的，標記為可更新/重新安裝
          return { ...local, status: 'update', latestVersion: latest.version }
        }
        if (latest.version !== local.version) {
          return { ...local, status: 'update', latestVersion: latest.version }
        }
        // Same version, but 'experimental-latest' reuses one tag forever — a
        // newer build only shows up as a changed published_at. Only flag it
        // when we actually recorded a publishedAt at install time; a missing
        // stored value (older HZMM install) is treated as up-to-date so we
        // don't nag on every launch — it backfills on the next install.
        if (local.publishedAt && latest.publishedAt && local.publishedAt !== latest.publishedAt) {
          return { ...local, status: 'update', latestVersion: latest.version }
        }
      }

      return { ...local, latestVersion: latest.version }
    } catch (err) {
      logger.warn(`UE4SS status check failed: ${err.message}`)
      return local
    }
  })

  const doInstallLogged = async () => {
    try { return await doInstall(mainWindow) }
    catch (e) { logger.error(`UE4SS deploy failed: ${e.message}`); throw e }
  }
  ipcMain.handle('ue4ss:install', doInstallLogged)
  ipcMain.handle('ue4ss:update', doInstallLogged)
}

export { registerUe4ssIpc }
