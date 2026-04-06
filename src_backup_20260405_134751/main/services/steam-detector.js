import { execSync } from 'child_process'
import { join } from 'path'
import fs from 'fs'
import { net } from 'electron'

const HUMANITZ_APP_ID = '2358160'
const HUMANITZ_STORE_APP_ID = '1766060' // Steam store uses different ID for news
const HUMANITZ_FOLDER_NAME = 'HumanitZ'

function getSteamPath() {
  try {
    // Try reading from registry (64-bit and 32-bit)
    const regPaths = [
      'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam',
      'HKLM\\SOFTWARE\\Valve\\Steam',
      'HKCU\\SOFTWARE\\Valve\\Steam'
    ]
    for (const regPath of regPaths) {
      try {
        const output = execSync(`reg query "${regPath}" /v InstallPath`, {
          encoding: 'utf-8',
          windowsHide: true
        })
        const match = output.match(/InstallPath\s+REG_SZ\s+(.+)/)
        if (match) return match[1].trim()
      } catch {
        continue
      }
    }
  } catch {
    // Fallback to common paths
    const common = [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      'D:\\Steam',
      'D:\\Program Files (x86)\\Steam'
    ]
    for (const p of common) {
      if (fs.existsSync(p)) return p
    }
  }
  return null
}

function parseLibraryFolders(steamPath) {
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

function detectGamePath() {
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

function getPaksPath(gamePath) {
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

function getAllPaksPaths(gamePath) {
  // 掃描用：回傳所有存在的 Paks 路徑，避免漏掉 mod
  const candidates = [
    join(gamePath, 'HumanitZ', 'Content', 'Paks', '~mods'),
    join(gamePath, 'HumanitZ', 'Content', 'Paks'),
    join(gamePath, 'Content', 'Paks', '~mods'),
    join(gamePath, 'Content', 'Paks')
  ]
  return candidates.filter(p => fs.existsSync(p))
}

function getGameExe(gamePath) {
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

function getUe4ssModsPath(gamePath) {
  const candidates = [
    join(gamePath, 'HumanitZ', 'Binaries', 'Win64', 'ue4ss', 'Mods'),
    join(gamePath, 'ue4ss', 'Mods'),
    join(gamePath, 'Mods')
  ]

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }

  return null
}

// 從 Steam News API 抓取最新版本名稱（如 "1.02.A"）
function fetchGameVersionFromSteamNews() {
  return new Promise((resolve) => {
    const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${HUMANITZ_STORE_APP_ID}&count=20&maxlength=0`
    const request = net.request(url)
    let body = ''

    request.on('response', (response) => {
      response.on('data', (chunk) => { body += chunk.toString() })
      response.on('end', () => {
        try {
          const data = JSON.parse(body)
          const items = data?.appnews?.newsitems || []
          // 找標題含版本號的公告，如 "HumanitZ 1.02.A Update"
          for (const item of items) {
            const match = item.title.match(/(\d+\.\d+(?:\.\w+)?)\s*(Update|Patch|Hotfix)/i)
            if (match) {
              resolve(match[1])
              return
            }
          }
          resolve(null)
        } catch {
          resolve(null)
        }
      })
    })

    request.on('error', () => resolve(null))
    request.end()

    // Electron net 沒有 setTimeout，用 setTimeout 手動超時
    setTimeout(() => { try { request.abort() } catch {} resolve(null) }, 5000)
  })
}

async function getGameVersion(gamePath) {
  if (!gamePath) return null

  // 方法 1：從 Steam News API 讀取版本名稱
  const versionName = await fetchGameVersionFromSteamNews()

  // 方法 2：從 Steam appmanifest 讀取 buildid
  let buildId = null
  let lastUpdated = null
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

  if (versionName || buildId) {
    return { versionName, buildId, lastUpdated }
  }

  // 方法 3：從遊戲 exe 的 file version 讀取（Windows only）
  try {
    const exePath = getGameExe(gamePath)
    if (exePath) {
      const output = execSync(
        `powershell -command "(Get-Item '${exePath.replace(/'/g, "''")}').VersionInfo.FileVersion"`,
        { encoding: 'utf-8', windowsHide: true, timeout: 5000 }
      ).trim()
      if (output && output !== '') {
        return { fileVersion: output }
      }
    }
  } catch {
    // ignore
  }

  return null
}

export { detectGamePath, getPaksPath, getAllPaksPaths, getGameExe, getUe4ssModsPath, getGameVersion }
