import { ipcMain, dialog, type BrowserWindow, type OpenDialogOptions } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store'
import logger from '../services/logger'
import { getLatestRelease, downloadRelease } from '../services/github-release'
import { extractZip, extractZipRaw } from '../services/archive'
import { resolveWithin } from '../services/path-safety'
import { mainText } from '../services/main-text'
import { currentLocale } from './locale'
import type { Ue4ssStatus } from './types'

type MainWindow = BrowserWindow | null | undefined

interface MovedFile {
  from: string
  to: string
}

interface SavedSettings {
  installPath: string
  rel: string
  content: Buffer
}

// UE4SS ships different proxy DLLs depending on engine version.
const PROXY_DLLS = ['dwmapi.dll', 'xinput1_3.dll', 'd3d11.dll', 'dsound.dll']

function getBinariesPath(): string | null {
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

function checkUe4ssStatus(): Ue4ssStatus {
  const binPath = getBinariesPath()
  if (!binPath) return { status: 'uninstalled', version: null }

  // experimental-latest: <proxy>.dll in Win64, UE4SS.dll in Win64/ue4ss/
  // 3.0.1: 全部在 Win64/
  // Every layout ships UE4SS.dll, whatever its proxy. A proxy name alone
  // proves nothing: ReShade, DXVK and ASI loaders drop d3d11.dll / dsound.dll.
  const hasNewStructure = fs.existsSync(path.join(binPath, 'ue4ss', 'UE4SS.dll'))
  const hasOldStructure = fs.existsSync(path.join(binPath, 'UE4SS.dll'))

  if (!hasNewStructure && !hasOldStructure) {
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
// install (same volume) so renameSync never hits EXDEV. Each {from,to} goes
// into the caller's `moved` right after its rename, so a throw partway through
// (a locked ue4ss/UE4SS.log) still lets the caller roll back what was moved.
function rotateUe4ssToBackup(binPath: string, backupDir: string, moved: MovedFile[] = []): MovedFile[] {
  const stash = (from: string, key: string) => {
    const to = path.join(backupDir, key)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.renameSync(from, to)
    moved.push({ from, to })
  }
  const knownFiles = ['dwmapi.dll', 'UE4SS.dll', 'UE4SS-settings.ini']
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
function restoreUe4ssBackup(moved: MovedFile[]): void {
  for (const { from, to } of moved) {
    try {
      if (fs.existsSync(from)) {
        if (fs.statSync(from).isDirectory()) fs.rmSync(from, { recursive: true, force: true })
        else fs.unlinkSync(from)
      }
      fs.mkdirSync(path.dirname(from), { recursive: true })
      fs.renameSync(to, from)
    } catch (err) {
      logger.warn(`UE4SS rollback failed for ${from}: ${(err as Error).message}`)
    }
  }
}

// A backup dir left by an earlier deploy that died or failed to roll back
// still holds the previous core files, UE4SS-settings.ini included. Put back
// every entry whose live path is missing before the dir is wiped, so the
// settings snapshot (and a rollback of this deploy) sees them again.
function recoverUe4ssBackup(binPath: string, backupDir: string): void {
  if (!fs.existsSync(backupDir)) return
  const keys: string[] = []
  try {
    for (const entry of fs.readdirSync(backupDir)) {
      if (entry !== 'ue4ss') { keys.push(entry); continue }
      // rotateUe4ssToBackup stashes the ue4ss/ subdir entry by entry.
      for (const sub of fs.readdirSync(path.join(backupDir, entry))) keys.push(path.join(entry, sub))
    }
  } catch (err) {
    logger.warn(`Could not read leftover UE4SS backup: ${(err as Error).message}`)
  }
  for (const key of keys) {
    const live = path.join(binPath, key)
    if (fs.existsSync(live)) continue
    try {
      fs.mkdirSync(path.dirname(live), { recursive: true })
      fs.renameSync(path.join(backupDir, key), live)
      logger.info(`Recovered ${key} from a leftover UE4SS backup`)
    } catch (err) {
      logger.warn(`UE4SS backup recovery failed for ${key}: ${(err as Error).message}`)
    }
  }
}

// UE4SS-settings.ini lives in one of two places depending on the install
// layout. Both are user-editable (graphics API, console toggles, custom
// keybinds).
const UE4SS_SETTINGS_RELATIVE_PATHS = ['UE4SS-settings.ini', path.join('ue4ss', 'UE4SS-settings.ini')]

// UE4SS's mod load lists. HZMM enables the mods it installs through these
// files alone, so the release archive's defaults must not replace them.
const UE4SS_MOD_LIST_RELATIVE_PATHS = [
  path.join('ue4ss', 'Mods', 'mods.txt'),
  path.join('ue4ss', 'Mods', 'mods.json'),
  path.join('Mods', 'mods.txt'),
  path.join('Mods', 'mods.json')
]

function snapshotUserSettings(installPath: string, rels: readonly string[] = UE4SS_SETTINGS_RELATIVE_PATHS): SavedSettings[] {
  const saved: SavedSettings[] = []
  for (const rel of rels) {
    const full = path.join(installPath, rel)
    if (fs.existsSync(full)) {
      // Keep installPath + the relative path (not just the absolute target) so
      // restoreUserSettings can re-derive the write target under resolveWithin
      // rather than trusting a stored absolute path.
      try { saved.push({ installPath, rel, content: fs.readFileSync(full) }) } catch { /* unreadable */ }
    }
  }
  return saved
}

function restoreUserSettings(saved: SavedSettings[]): void {
  for (const { installPath, rel, content } of saved) {
    try {
      // Re-resolve the write target under the path guard. The rel paths come
      // from UE4SS_SETTINGS_RELATIVE_PATHS (not renderer input), so this is
      // defense-in-depth: it keeps the "writes stay inside installPath"
      // invariant explicit and refactor-proof rather than trusting a stored
      // absolute path.
      const full = resolveWithin(installPath, rel)
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, content)
      logger.info(`Preserved UE4SS-settings.ini at ${full}`)
    } catch (err) {
      logger.warn(`Failed to restore UE4SS-settings.ini: ${(err as Error).message}`)
    }
  }
}

const MODS_TXT_ENTRY = /^\uFEFF?([^:;]+?)\s*:\s*\d+/
const MODS_TXT_KEYBINDS = /^;.*keybinds.*$/im

// The user's mods.txt plus every `Name : N` line of the release's that names
// a mod the user's file lacks. Release lines above the "; Built-in keybinds"
// comment go above the user's copy of it (where mods-registry adds mods);
// lines below it stay at the end.
function mergeModsTxt(user: string, release: string): string {
  const have = new Set<string>()
  for (const line of user.split(/\r?\n/)) {
    const m = line.match(MODS_TXT_ENTRY)
    if (m) have.add(m[1].trim().toLowerCase())
  }
  const above: string[] = []
  const below: string[] = []
  let pastKeybinds = false
  for (const line of release.split(/\r?\n/)) {
    if (MODS_TXT_KEYBINDS.test(line)) { pastKeybinds = true; continue }
    const m = line.match(MODS_TXT_ENTRY)
    if (!m || have.has(m[1].trim().toLowerCase())) continue
    have.add(m[1].trim().toLowerCase())
    if (pastKeybinds) below.push(line.replace(/^\uFEFF/, ''))
    else above.push(line.replace(/^\uFEFF/, ''))
  }
  if (above.length === 0 && below.length === 0) return user
  const eol = user.includes('\r\n') ? '\r\n' : '\n'
  let merged = user
  if (above.length > 0) {
    const keybinds = merged.match(MODS_TXT_KEYBINDS)
    if (keybinds) merged = merged.replace(keybinds[0], () => `${above.join(eol)}${eol}${keybinds[0]}`)
    else below.unshift(...above)
  }
  if (below.length > 0) merged = `${merged.trimEnd()}${eol}${below.join(eol)}${eol}`
  return merged
}

// The user's mods.json array plus the release's entries for mods it lacks.
// Whichever side isn't a JSON array is dropped.
function mergeModsJson(user: string, release: string): string {
  const parse = (text: string): unknown[] | null => {
    try {
      const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ''))
      return Array.isArray(value) ? value : null
    } catch { return null }
  }
  const userMods = parse(user)
  const releaseMods = parse(release)
  if (!userMods) return release
  if (!releaseMods) return user
  const nameOf = (m: unknown): string | null => {
    const name = (m as { mod_name?: unknown } | null)?.mod_name
    return typeof name === 'string' ? name.toLowerCase() : null
  }
  const have = new Set(userMods.map(nameOf).filter((n): n is string => n !== null))
  const added = releaseMods.filter(m => {
    const name = nameOf(m)
    if (name === null || have.has(name)) return false
    have.add(name)
    return true
  })
  if (added.length === 0) return user
  return JSON.stringify([...userMods, ...added], null, 4)
}

// After a successful extract: merge the release's mod lists into the user's.
// After a failed one: put the user's files back as they were, since a
// partial extract may already have overwritten them.
function restoreModLists(saved: SavedSettings[], merge: boolean): void {
  for (const { installPath, rel, content } of saved) {
    try {
      const full = resolveWithin(installPath, rel)
      let next: string | Buffer = content
      if (merge && fs.existsSync(full)) {
        const user = content.toString('utf-8')
        const release = fs.readFileSync(full, 'utf-8')
        const merged = rel.endsWith('.json') ? mergeModsJson(user, release) : mergeModsTxt(user, release)
        if (merged !== user) next = merged
      }
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, next)
    } catch (err) {
      logger.warn(`Failed to restore UE4SS mod list ${rel}: ${(err as Error).message}`)
    }
  }
}

// Shared deploy: snapshot user settings → rotate old core files aside →
// extract → restore settings. Used by both the GitHub download path and the
// local-zip fallback.
async function deployZip(installPath: string, zipPath: string): Promise<void> {
  const backupDir = path.join(installPath, '_hzmm_ue4ss_backup')
  recoverUe4ssBackup(installPath, backupDir)

  // Capture user-customized UE4SS-settings.ini BEFORE rotate + extract.
  // The settings file is rotated aside with the rest, and the archive's fresh
  // settings.ini would overwrite during extract — so re-apply it afterwards.
  const savedSettings = snapshotUserSettings(installPath)
  // The Mods folder stays in place, but the archive's default mod lists
  // would overwrite the user's during extract.
  const savedModLists = snapshotUserSettings(installPath, UE4SS_MOD_LIST_RELATIVE_PATHS)

  // Rotate old core files aside (keeping the user's Mods) instead of deleting,
  // so a failed extract rolls back to the working install rather than leaving
  // UE4SS half-deleted and unloadable.
  fs.rmSync(backupDir, { recursive: true, force: true })
  fs.mkdirSync(backupDir, { recursive: true })
  const rotated: MovedFile[] = []
  try {
    rotateUe4ssToBackup(installPath, backupDir, rotated)
    // Extract to game directory (不走 mod 分析，直接全部解壓)
    await extractZipRaw(zipPath, installPath)
  } catch (err) {
    restoreUe4ssBackup(rotated)
    restoreModLists(savedModLists, false)
    throw err
  }

  // Put user's settings back, overwriting the freshly-extracted defaults.
  restoreUserSettings(savedSettings)
  restoreModLists(savedModLists, true)
  // The new install is in place; a backup dir that can't be removed now is
  // recovered (missing files only) by the next deploy.
  try { fs.rmSync(backupDir, { recursive: true, force: true }) } catch (err) {
    logger.warn(`Could not remove UE4SS backup dir: ${(err as Error).message}`)
  }
}

async function doInstall(mainWindow: MainWindow): Promise<{ version: string }> {
  const installPath = getBinariesPath()
  if (!installPath) throw new Error('GAME_PATH_NOT_FOUND')

  const release = await getLatestRelease()
  if (!release.downloadUrl) throw new Error('No download URL found')

  const tempDir = configStore.getConfigDir()
  const tempZip = path.join(tempDir, 'ue4ss_temp.zip')

  try {
    // Download with progress
    await downloadRelease(release.downloadUrl, tempZip, (progress: number) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ue4ss:progress', progress)
      }
    })

    await deployZip(installPath, tempZip)

    // Store version + published_at. The latter is what detects a fresh build
    // of the rolling 'experimental-latest' tag (whose version never changes).
    configStore.set('ue4ssVersion', release.version)
    configStore.set('ue4ssPublishedAt', release.publishedAt || null)

    logger.info(`UE4SS deployed: version ${release.version}`)
    return { version: release.version }
  } finally {
    // Cleanup temp file
    if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip)
  }
}

// Fallback for users who can't reach GitHub from the app (blocked CDN, proxy
// the app can't use): they download a UE4SS release zip themselves and pick
// it here. Same rotate/extract/rollback path as the online install.
async function doInstallFromFile(mainWindow: MainWindow): Promise<{ canceled: true } | { version: string }> {
  const installPath = getBinariesPath()
  if (!installPath) throw new Error('GAME_PATH_NOT_FOUND')

  const text = mainText(currentLocale())
  const options: OpenDialogOptions = {
    title: text.ue4ssZipTitle,
    filters: [{ name: text.ue4ssZipFilter, extensions: ['zip'] }],
    properties: ['openFile']
  }
  // Same dialog as before: parented to the main window when there is one.
  const { canceled, filePaths } = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (canceled || !filePaths || filePaths.length === 0) return { canceled: true }
  const zipPath = filePaths[0]

  // Refuse anything that isn't a release laid out for Win64 (a proxy DLL at
  // the root, UE4SS.dll at the root or in ue4ss/) — rotating the working
  // install aside for a random zip, or one whose files sit in a wrapper
  // folder, would trash it for nothing.
  // analyzeOnly reads the entry table without writing a byte and resolves the
  // structure analysis plus the archive's entry names (normalized to '/').
  const { entryNames } = await extractZip(zipPath, installPath, true) as { entryNames: string[] }
  const lower = new Set(entryNames.map((n: string) => n.toLowerCase()))
  const hasCore = lower.has('ue4ss/ue4ss.dll') || lower.has('ue4ss.dll')
  const hasProxy = PROXY_DLLS.some(name => lower.has(name))
  if (!hasCore || !hasProxy) {
    throw new Error('INVALID_UE4SS_ZIP')
  }

  await deployZip(installPath, zipPath)

  // A hand-picked zip has no trustworthy version identity — record 'manual'
  // so ue4ss:status neither nags "update" forever (the download that update
  // needs is exactly what failed for these users) nor claims a real version.
  configStore.set('ue4ssVersion', 'manual')
  configStore.set('ue4ssPublishedAt', null)

  logger.info(`UE4SS deployed from local zip: ${zipPath}`)
  return { version: 'manual' }
}

function registerUe4ssIpc(mainWindow: MainWindow): void {
  ipcMain.handle('ue4ss:status', async (): Promise<Ue4ssStatus> => {
    const local = checkUe4ssStatus()

    try {
      const latest = await getLatestRelease()

      if (local.status === 'installed') {
        if (local.version === 'manual') {
          // Installed from a user-picked zip: no comparable version or
          // publishedAt, and nagging "update" would push these users back
          // into the download path that failed for them. Treat as current.
          return { ...local, latestVersion: latest.version }
        }
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
      logger.warn(`UE4SS status check failed: ${(err as Error).message}`)
      return local
    }
  })

  const doInstallLogged = async () => {
    try { return await doInstall(mainWindow) }
    catch (e) { logger.error(`UE4SS deploy failed: ${(e as Error).message}`); throw e }
  }
  ipcMain.handle('ue4ss:install', doInstallLogged)
  ipcMain.handle('ue4ss:update', doInstallLogged)
  ipcMain.handle('ue4ss:install-from-file', async () => {
    try { return await doInstallFromFile(mainWindow) }
    catch (e) { logger.error(`UE4SS local-zip deploy failed: ${(e as Error).message}`); throw e }
  })
}

export { registerUe4ssIpc }
