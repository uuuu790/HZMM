import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import { getLatestRelease, downloadRelease } from '../services/github-release.js'
import { extractZipRaw } from '../services/archive.js'

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

  // experimental-latest: dwmapi.dll in Win64, UE4SS.dll in Win64/ue4ss/
  // 3.0.1: 全部在 Win64/
  const hasNewStructure = fs.existsSync(path.join(binPath, 'ue4ss', 'UE4SS.dll'))
  const hasOldStructure = fs.existsSync(path.join(binPath, 'UE4SS.dll'))
  const hasDwmapi = fs.existsSync(path.join(binPath, 'dwmapi.dll'))

  if (!hasDwmapi && !hasNewStructure && !hasOldStructure) {
    return { status: 'uninstalled', version: null }
  }

  const installedVersion = configStore.get('ue4ssVersion', null)
  const structure = hasNewStructure ? 'experimental' : 'legacy'
  return { status: 'installed', version: installedVersion, structure }
}

function cleanUe4ssFiles(binPath) {
  // 清理已知的 UE4SS 檔案，避免舊版本殘留
  const knownFiles = ['dwmapi.dll', 'UE4SS.dll', 'UE4SS-settings.ini']
  for (const file of knownFiles) {
    const filePath = path.join(binPath, file)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  }
  // 清理 ue4ss 子目錄（experimental 結構）
  const ue4ssSubDir = path.join(binPath, 'ue4ss')
  if (fs.existsSync(ue4ssSubDir)) {
    // 保留 Mods 資料夾（使用者的 mod 不能刪）
    const modsDir = path.join(ue4ssSubDir, 'Mods')
    const entries = fs.readdirSync(ue4ssSubDir)
    for (const entry of entries) {
      if (entry === 'Mods') continue
      const entryPath = path.join(ue4ssSubDir, entry)
      const stat = fs.statSync(entryPath)
      if (stat.isDirectory()) {
        fs.rmSync(entryPath, { recursive: true, force: true })
      } else {
        fs.unlinkSync(entryPath)
      }
    }
  }
}

async function doInstall(mainWindow) {
  const installPath = getBinariesPath()
  if (!installPath) throw new Error('Game binaries path not found')

  const release = await getLatestRelease()
  if (!release.downloadUrl) throw new Error('No download URL found')

  const tempDir = configStore.CONFIG_DIR
  const tempZip = path.join(tempDir, 'ue4ss_temp.zip')

  try {
    // Download with progress
    await downloadRelease(release.downloadUrl, tempZip, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ue4ss:progress', progress)
      }
    })

    // 清理舊版本檔案（保留使用者 Mods）
    cleanUe4ssFiles(installPath)

    // Extract to game directory (不走 mod 分析，直接全部解壓)
    await extractZipRaw(tempZip, installPath)

    // Store version
    configStore.set('ue4ssVersion', release.version)

    return { version: release.version }
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
      }

      return { ...local, latestVersion: latest.version }
    } catch {
      return local
    }
  })

  ipcMain.handle('ue4ss:install', () => doInstall(mainWindow))

  ipcMain.handle('ue4ss:update', () => doInstall(mainWindow))
}

export { registerUe4ssIpc }
