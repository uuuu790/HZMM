import { ipcMain, app } from 'electron'
import { spawn } from 'child_process'
import { checkForUpdate, downloadUpdate, computeFileHash, getVerifiedUpdate } from '../services/app-updater.js'
import configStore from '../services/config-store.js'
import path from 'path'
import fs from 'fs'
import logger from '../services/logger.js'

// Characters that break batch-script quoting or line structure.
// Double-quote and single-quote would terminate the surrounding "..."
// CR / LF would inject new batch lines.
// % and ! are variable-expansion sigils.
// & | < > ^ are shell metacharacters.
// Null byte would truncate the string in native APIs.
const UNSAFE_BATCH_PATH_CHARS = /[%!^&|<>"'\r\n\0]/

export function assertSafeBatchPath(label, value) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`${label}: path must be a non-empty string`)
  }
  if (UNSAFE_BATCH_PATH_CHARS.test(value)) {
    throw new Error(`${label}: path contains characters unsafe for batch execution`)
  }
  // win32 explicitly, not the platform-dependent `path`: this value is always a
  // Windows path (it gets baked into a .bat run by cmd.exe), so `C:\...` must
  // validate as absolute even when this module is loaded on a POSIX host — which
  // is exactly what the unit suite does on Linux CI.
  if (!path.win32.isAbsolute(value)) {
    throw new Error(`${label}: path must be absolute`)
  }
}

// Portable target (electron-builder) extracts the app to a temp/cache dir
// on every launch; `app.getPath('exe')` points there, NOT to the .exe the
// user double-clicked. Overwriting the temp path "succeeds" but is wiped
// on next launch, so the update never sticks. `PORTABLE_EXECUTABLE_FILE`
// is injected by the portable launcher and points to the persistent .exe.
export function resolvePortableExePath(env, runningExePath) {
  return env.PORTABLE_EXECUTABLE_FILE || runningExePath
}

// Pure function — easy to unit test. Throws on any unsafe input.
export function generateUpdaterBatch(newExePath, currentExePath) {
  assertSafeBatchPath('newExePath', newExePath)
  assertSafeBatchPath('currentExePath', currentExePath)

  // Copy may fail with "file in use" when Windows Defender / slow shutdown
  // keeps the exe locked past the initial 2s delay. Retry up to 10 times
  // with a 1s pause between attempts before giving up.
  return [
    '@echo off',
    'timeout /t 2 /nobreak >nul',
    'set /a tries=0',
    ':retry',
    `copy /y "${newExePath}" "${currentExePath}" >nul`,
    'if errorlevel 1 (',
    '  set /a tries+=1',
    '  if %tries% geq 10 (',
    '    echo Update copy failed after 10 retries >&2',
    '    exit /b 1',
    '  )',
    '  timeout /t 1 /nobreak >nul',
    '  goto retry',
    ')',
    `del /f "${newExePath}" >nul 2>&1`,
    `start "" "${currentExePath}"`,
    `del /f "%~f0" >nul 2>&1`,
  ].join('\r\n')
}

function registerAppUpdateIpc(mainWindow) {
  ipcMain.handle('app-update:get-version', () => {
    return app.getVersion()
  })

  ipcMain.handle('app-update:check', async () => {
    try {
      return await checkForUpdate()
    } catch (err) {
      logger.error(`Update check failed: ${err.message}`)
      return { hasUpdate: false, currentVersion: app.getVersion(), error: err.message }
    }
  })

  // Renderer-supplied URL/hash are IGNORED — re-fetch canonical release
  // info from GitHub. Trusting the renderer means an XSS-compromised
  // renderer could supply any github.com binary as the "update" plus
  // a null hash to skip integrity check, chaining to self-replace the
  // HZMM executable. The download host allow-list inside downloadUpdate()
  // only restricts to github.com, not specifically to our repo.
  ipcMain.handle('app-update:download', async () => {
    try {
      const release = await checkForUpdate()
      if (!release.hasUpdate || !release.downloadUrl) {
        throw new Error('No update available')
      }

      const filePath = await downloadUpdate(release.downloadUrl, release.expectedHash, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('app-update:progress', progress)
        }
      })

      return { filePath }
    } catch (err) {
      logger.error(`Update download failed: ${err.message}`)
      throw err
    }
  })

  // Double-click protection: a second invoke would spawn a parallel cmd.exe
  // racing the first batch's copy + start, ending with two app instances.
  // Successful path quits the app, so we only reset on error.
  let installInFlight = false
  ipcMain.handle('app-update:install', async () => {
    if (installInFlight) {
      throw new Error('Update install already in progress')
    }
    installInFlight = true
    try {
      const newExePath = path.join(configStore.getConfigDir(), 'hzmm-update.exe')
      if (!fs.existsSync(newExePath)) {
        throw new Error('Update file not found. Please download first.')
      }

      // Re-verify the on-disk exe against the hash computed at download time.
      // download and install are independent IPC calls and the file lives at a
      // fixed, user-writable path — without this, a binary swapped in between
      // would be copied over the running app and executed (TOCTOU). A missing
      // record (e.g. app restarted since download) forces a fresh download.
      const verified = getVerifiedUpdate()
      const actualHash = await computeFileHash(newExePath)
      if (!verified || verified.path !== newExePath || verified.hash !== actualHash) {
        try { fs.unlinkSync(newExePath) } catch { /* best-effort */ }
        throw new Error('Update file failed re-verification. Please download the update again.')
      }

      const currentExePath = resolvePortableExePath(process.env, app.getPath('exe'))
      const batPath = path.join(configStore.getConfigDir(), 'updater.bat')

      // Preflight: writable target, unsafe-char validation done inside generateUpdaterBatch
      try {
        fs.accessSync(currentExePath, fs.constants.W_OK)
      } catch (err) {
        throw new Error(`Cannot write to current executable: ${err.message}`)
      }

      const batContent = generateUpdaterBatch(newExePath, currentExePath)

      fs.writeFileSync(batPath, batContent, 'utf-8')
      logger.info(`Update script created: ${batPath}`)
      logger.info(`Replacing: ${currentExePath}`)

      const child = spawn('cmd', ['/c', batPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })

      // The quit is scheduled below. But spawn('error') fires asynchronously
      // (after this handler returns), so if cmd.exe fails to start (e.g. AV
      // blocks it) the batch never runs — yet without intervention the app
      // would still quit in 500ms WITHOUT updating, installInFlight would stay
      // stuck true, and the user would see no error. So on spawn failure:
      // cancel the pending quit, reset the guard, and notify the renderer.
      let quitTimer = null
      child.on('error', (err) => {
        if (quitTimer) { clearTimeout(quitTimer); quitTimer = null }
        installInFlight = false
        logger.error(`Failed to start updater: ${err.message}`)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('app-update:install-failed', err.message)
        }
      })

      child.unref()

      quitTimer = setTimeout(() => {
        app.quit()
      }, 500)
    } catch (err) {
      installInFlight = false
      throw err
    }
  })
}

export { registerAppUpdateIpc }
