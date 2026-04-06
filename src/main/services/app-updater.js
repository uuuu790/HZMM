import https from 'https'
import { app } from 'electron'
import { downloadFile } from './archive.js'
import configStore from './config-store.js'
import path from 'path'
import fs from 'fs'
import logger from './logger.js'

const REPO = 'uuuu790/HZMM'
const REQUEST_TIMEOUT_MS = 10000

function githubGet(endpoint, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'))
      return
    }

    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      headers: {
        'User-Agent': 'HZMM-Manager/1.0.0',
        'Accept': 'application/vnd.github.v3+json'
      }
    }

    const req = https.get(options, (res) => {
      // Bug 8 fix: handle HTTP redirects (3xx)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location)
        const redirectOptions = {
          hostname: redirectUrl.hostname,
          path: redirectUrl.pathname + redirectUrl.search,
          headers: options.headers
        }
        // Consume the response body before following redirect
        res.resume()
        const redirectReq = https.get(redirectOptions, (redirectRes) => {
          handleResponse(redirectRes, resolve, reject, maxRedirects - 1)
        })
        redirectReq.on('error', reject)
        redirectReq.setTimeout(REQUEST_TIMEOUT_MS, () => {
          redirectReq.destroy()
          reject(new Error('GitHub API request timed out'))
        })
        return
      }

      handleResponse(res, resolve, reject, maxRedirects)
    })

    req.on('error', reject)

    // Bug 7 fix: abort request after 10 seconds if GitHub API hangs
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy()
      reject(new Error('GitHub API request timed out'))
    })
  })
}

function handleResponse(res, resolve, reject, maxRedirects) {
  // Handle nested redirects
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'))
      return
    }
    const redirectUrl = new URL(res.headers.location)
    const redirectOptions = {
      hostname: redirectUrl.hostname,
      path: redirectUrl.pathname + redirectUrl.search,
      headers: {
        'User-Agent': 'HZMM-Manager/1.0.0',
        'Accept': 'application/vnd.github.v3+json'
      }
    }
    res.resume()
    const req = https.get(redirectOptions, (redirectRes) => {
      handleResponse(redirectRes, resolve, reject, maxRedirects - 1)
    })
    req.on('error', reject)
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy()
      reject(new Error('GitHub API request timed out'))
    })
    return
  }

  let data = ''
  res.on('data', chunk => { data += chunk })
  res.on('end', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      reject(new Error(`GitHub API error: HTTP ${res.statusCode}`))
      return
    }
    try {
      resolve(JSON.parse(data))
    } catch {
      reject(new Error('Failed to parse GitHub response'))
    }
  })
}

// Bug 15 fix: strip pre-release suffix before comparing
function compareVersions(current, latest) {
  const a = current.replace(/^v/, '').split('-')[0].split('.').map(Number)
  const b = latest.replace(/^v/, '').split('-')[0].split('.').map(Number)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const av = a[i] || 0
    const bv = b[i] || 0
    if (bv > av) return true
    if (bv < av) return false
  }
  return false
}

async function checkForUpdate() {
  const currentVersion = app.getVersion()
  logger.info(`Checking for updates... current version: ${currentVersion}`)

  const release = await githubGet(`/repos/${REPO}/releases/latest`)
  if (!release || !release.tag_name) {
    throw new Error('No release found')
  }

  const latestVersion = release.tag_name
  const hasUpdate = compareVersions(currentVersion, latestVersion)

  const asset = release.assets?.find(a => a.name.toLowerCase().endsWith('.exe'))

  const result = {
    hasUpdate,
    currentVersion,
    latestVersion,
    downloadUrl: asset?.browser_download_url || null,
    changelog: release.body || ''
  }

  if (hasUpdate) {
    logger.info(`Update available: ${latestVersion}`)
  } else {
    logger.info(`Already up to date: ${currentVersion}`)
  }

  return result
}

async function downloadUpdate(url, onProgress) {
  const destPath = path.join(configStore.getConfigDir(), 'hzmm-update.exe')

  if (fs.existsSync(destPath)) fs.unlinkSync(destPath)

  logger.info(`Downloading update from: ${url}`)
  await downloadFile(url, destPath, onProgress)
  logger.info(`Update downloaded to: ${destPath}`)

  return destPath
}

export { checkForUpdate, downloadUpdate, compareVersions }
