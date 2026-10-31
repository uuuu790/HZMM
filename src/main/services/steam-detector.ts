import { execFileSync } from 'child_process'
import { join, normalize, resolve, sep } from 'path'
import fs from 'fs'
import configStore from './config-store'
import { netRequest } from './net-client'
import type { GameVersionInfo } from '../ipc/types'

const HUMANITZ_APP_ID = '1766060' // 遊戲本體 app id：appmanifest / 啟動 / news 同一個
const HUMANITZ_FOLDER_NAME = 'HumanitZ'

// undefined = not probed yet; null = probed, Steam not found.
let cachedSteamPath: string | null | undefined = undefined

function readRegistryViaPowerShell(key: string, value: string): string | null {
  try {
    const output = execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-ItemPropertyValue -LiteralPath $env:HZMM_REG_KEY -Name $env:HZMM_REG_VALUE'],
      { encoding: 'utf-8', windowsHide: true, timeout: 5000, env: { ...process.env, HZMM_REG_KEY: key.replace(/^(HKLM|HKCU)\\/, '$1:\\'), HZMM_REG_VALUE: value } }
    ).replace(/^\uFEFF/, '').trim()
    return output || null
  } catch {
    return null
  }
}

// A registry folder value, normalized, or null unless that folder exists.
// reg.exe writes redirected output in the console's OEM code page (cp950,
// cp932, cp437, ...), not UTF-8. A character that page cannot hold comes out
// as '?' (pure ASCII, but illegal in a Windows path) or as a best-fit ASCII
// look-alike, so reg.exe's value is used only when it is pure ASCII, has no
// '?' and names an existing folder. Otherwise the value is read again through
// PowerShell with UTF-8 output. When reg.exe finds no such value, PowerShell
// would not either, so it is not started.
function readRegistryDir(key: string, value: string): string | null {
  let raw: Buffer
  try {
    raw = execFileSync('reg', ['query', key, '/v', value], { windowsHide: true, timeout: 5000 })
  } catch {
    return null
  }
  const existing = (p: string | null): string | null => {
    if (!p) return null
    const candidate = normalize(p)
    return fs.existsSync(candidate) ? candidate : null
  }
  if (raw.every(b => b < 0x80)) {
    const match = raw.toString('latin1').match(new RegExp(`${value}\\s+REG_SZ\\s+(.+)`))
    const text = match ? match[1].trim() : ''
    const found = text.includes('?') ? null : existing(text)
    if (found) return found
  }
  return existing(readRegistryViaPowerShell(key, value))
}

function getSteamPath(): string | null {
  if (cachedSteamPath !== undefined) return cachedSteamPath

  // Try reading from registry (64-bit and 32-bit). HKCU holds SteamPath
  // (forward slashes), not InstallPath. A value pointing at a removed or
  // unreadable folder is skipped, not cached.
  const regValues: Array<[string, string]> = [
    ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
    ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'],
    ['HKCU\\SOFTWARE\\Valve\\Steam', 'SteamPath']
  ]
  for (const [key, value] of regValues) {
    const found = readRegistryDir(key, value)
    if (found) {
      cachedSteamPath = found
      return cachedSteamPath
    }
  }

  // Registry miss or reg.exe unavailable — probe common install dirs
  const common = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'D:\\Steam',
    'D:\\Program Files (x86)\\Steam'
  ]
  for (const p of common) {
    if (fs.existsSync(p)) {
      cachedSteamPath = p
      return cachedSteamPath
    }
  }

  cachedSteamPath = null
  return null
}

function parseLibraryFolders(steamPath: string): string[] {
  const vdfPath = join(steamPath, 'steamapps', 'libraryfolders.vdf')
  if (!fs.existsSync(vdfPath)) return [steamPath]

  const content = fs.readFileSync(vdfPath, 'utf-8')
  const paths = [steamPath]

  // Simple VDF parser - extract "path" values
  const pathMatches = content.matchAll(/"path"\s+"([^"]+)"/g)
  for (const m of pathMatches) {
    const p = m[1].replace(/\\\\/g, '\\')
    if (!paths.includes(p)) paths.push(p)
  }

  return paths
}

function detectGamePath(): string | null {
  const steamPath = getSteamPath()
  if (!steamPath) return null

  const libraryPaths = parseLibraryFolders(steamPath)

  for (const libPath of libraryPaths) {
    const gamePath = join(libPath, 'steamapps', 'common', HUMANITZ_FOLDER_NAME)
    if (fs.existsSync(gamePath)) {
      // Verify it's the right game by checking for exe or Content folder
      const hasExe = fs.readdirSync(gamePath).some(f => f.endsWith('.exe'))
      if (hasExe) return gamePath
    }
  }

  return null
}

// Whether gamePath is the Steam-managed copy (under a Steam library's
// steamapps/common). Only then is launching via steam:// correct — a
// manually-set non-Steam copy must be spawned directly.
function isSteamGame(gamePath: string | null | undefined): boolean {
  const steamPath = getSteamPath()
  if (!steamPath || !gamePath) return false
  const norm = resolve(gamePath).toLowerCase()
  for (const lib of parseLibraryFolders(steamPath)) {
    const common = resolve(join(lib, 'steamapps', 'common')).toLowerCase()
    if (norm === common || norm.startsWith(common + sep)) return true
  }
  return false
}

function getPaksPath(gamePath: string): string | null {
  // HumanitZ UE 結構：<Game>/<GameName>/Content/Paks/
  // 安裝用：優先回傳 ~mods，其次 Paks 根目錄
  const candidates = [
    join(gamePath, 'HumanitZ', 'Content', 'Paks', '~mods'),
    join(gamePath, 'HumanitZ', 'Content', 'Paks'),
    join(gamePath, 'Content', 'Paks', '~mods'),
    join(gamePath, 'Content', 'Paks')
  ]

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }

  // Fallback: 在正確的 UE 結構下建立 Paks 目錄
  const defaultPaks = join(gamePath, 'HumanitZ', 'Content', 'Paks')
  if (fs.existsSync(gamePath)) {
    fs.mkdirSync(defaultPaks, { recursive: true })
    return defaultPaks
  }

  return null
}

function getAllPaksPaths(gamePath: string): string[] {
  // 掃描用：回傳所有存在的 Paks 路徑，避免漏掉 mod
  const candidates = [
    join(gamePath, 'HumanitZ', 'Content', 'Paks', '~mods'),
    join(gamePath, 'HumanitZ', 'Content', 'Paks'),
    join(gamePath, 'Content', 'Paks', '~mods'),
    join(gamePath, 'Content', 'Paks')
  ]
  return candidates.filter(p => fs.existsSync(p))
}

function getGameExe(gamePath: string | null | undefined): string | null {
  if (!gamePath || !fs.existsSync(gamePath)) return null
  const files = fs.readdirSync(gamePath)
  // Look for main exe (not crash reporter, not uninstaller)
  const exe = files.find(f =>
    f.endsWith('.exe') &&
    !f.toLowerCase().includes('crash') &&
    !f.toLowerCase().includes('unins') &&
    !f.toLowerCase().includes('ue4prereq') &&
    !f.toLowerCase().includes('redist')
  )
  return exe ? join(gamePath, exe) : null
}

function getUe4ssModsPath(gamePath: string): string | null {
  // Same binaries dirs as ue4ss.ts getBinariesPath. Experimental layout:
  // Win64/ue4ss/Mods. Flat 3.0.1 layout: Win64/Mods next to Win64/UE4SS.dll
  // (the dll check skips a stale Win64/Mods left by an older install).
  for (const bin of [join(gamePath, 'HumanitZ', 'Binaries', 'Win64'), join(gamePath, 'Binaries', 'Win64')]) {
    const nested = join(bin, 'ue4ss', 'Mods')
    if (fs.existsSync(nested)) return nested
    const flat = join(bin, 'Mods')
    if (fs.existsSync(flat) && fs.existsSync(join(bin, 'UE4SS.dll'))) return flat
  }

  // Last resort: Mods folders at the game root.
  const candidates = [
    join(gamePath, 'ue4ss', 'Mods'),
    join(gamePath, 'Mods')
  ]

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }

  return null
}

// 從 Steam News API 抓取最新版本名稱（如 "1.02.A"）
// netRequest handles request AND response stream errors (an unhandled
// response 'error' is an uncaught exception in main) plus the 3 s deadline.
async function fetchGameVersionFromSteamNews(): Promise<string | null> {
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${HUMANITZ_APP_ID}&count=20&maxlength=0`
  try {
    const res = await netRequest(url, { timeoutMs: 3000, timeoutMessage: 'Steam News timed out' })
    if (res.statusCode < 200 || res.statusCode >= 300) return null
    const data = JSON.parse(res.bodyText)
    const items = data?.appnews?.newsitems
    // 找標題含版本號的公告，如 "HumanitZ 1.02.A Update"
    for (const item of Array.isArray(items) ? items : []) {
      const match = String(item?.title ?? '').match(/(\d+\.\d+(?:\.\w+)?)\s*(Update|Patch|Hotfix)/i)
      if (match) return match[1]
    }
    return null
  } catch {
    return null
  }
}

function getGameVersionCached(): GameVersionInfo | null {
  const cached = configStore.get('cachedGameVersion')
  return cached || null
}

async function getGameVersion(gamePath: string | null | undefined): Promise<GameVersionInfo | null> {
  if (!gamePath) return null

  // 方法 1：從 Steam appmanifest 讀取 buildid（本地、快速）
  let buildId: string | null = null
  let lastUpdated: string | null = null
  const steamPath = getSteamPath()
  if (steamPath) {
    const libraryPaths = parseLibraryFolders(steamPath)
    for (const libPath of libraryPaths) {
      const manifestPath = join(libPath, 'steamapps', `appmanifest_${HUMANITZ_APP_ID}.acf`)
      if (fs.existsSync(manifestPath)) {
        const content = fs.readFileSync(manifestPath, 'utf-8')
        const buildMatch = content.match(/"buildid"\s+"(\d+)"/)
        const updatedMatch = content.match(/"LastUpdated"\s+"(\d+)"/)
        if (buildMatch) {
          buildId = buildMatch[1]
          lastUpdated = updatedMatch ? new Date(parseInt(updatedMatch[1]) * 1000).toLocaleDateString() : null
        }
        break
      }
    }
  }

  // 方法 2：從 Steam News API 讀取版本名稱（網路、慢）
  const fetchedName = await fetchGameVersionFromSteamNews()

  if (fetchedName || buildId) {
    // A failed/slow News fetch must not drop the name already cached for this
    // same build; a different build gets no stale name.
    const prev = configStore.get('cachedGameVersion')
    const prevName = prev && 'buildId' in prev && prev.buildId && prev.buildId === buildId ? prev.versionName : null
    const versionName = fetchedName ?? prevName ?? null
    const result = { versionName, buildId, lastUpdated }
    configStore.set('cachedGameVersion', result)
    return result
  }

  // 方法 3：從遊戲 exe 的 file version 讀取（Windows only）
  try {
    const exePath = getGameExe(gamePath)
    if (exePath) {
      // Pass the exe path via an env var, not string-interpolated into the
      // command — execFileSync skips cmd.exe entirely and PowerShell reads it as
      // data, so no path character (& ^ % ' ") can break quoting or inject.
      const output = execFileSync(
        'powershell',
        ['-NoProfile', '-Command', '(Get-Item -LiteralPath $env:HZMM_EXE_PATH).VersionInfo.FileVersion'],
        { encoding: 'utf-8', windowsHide: true, timeout: 5000, env: { ...process.env, HZMM_EXE_PATH: exePath } }
      ).trim()
      if (output && output !== '') {
        const result = { fileVersion: output }
        configStore.set('cachedGameVersion', result)
        return result
      }
    }
  } catch {
    // ignore
  }

  return null
}

export { detectGamePath, getPaksPath, getAllPaksPaths, getGameExe, getUe4ssModsPath, getGameVersion, getGameVersionCached, isSteamGame, HUMANITZ_APP_ID }
