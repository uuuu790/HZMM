import crypto from 'crypto'
import { app } from 'electron'
import { downloadFile, type ProgressCallback } from './archive'
import { netRequest } from './net-client'
import configStore from './config-store'
import path from 'path'
import fs from 'fs'
import logger from './logger'
import type { GithubRelease } from './github-release'
import type { UpdateCheckInfo } from '../ipc/types'

const REPO = 'uuuu790/HZMM'
const REQUEST_TIMEOUT_MS = 10000
// downloadFile matches these exactly on every redirect hop — GitHub rotates
// release-asset redirects between objects. and release-assets., so both must
// be listed or self-update breaks when GitHub serves the rotated host.
const ALLOWED_DOWNLOAD_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']
const ALLOWED_API_HOSTS = ['api.github.com', 'github.com', 'objects.githubusercontent.com', 'codeload.github.com']

function githubHeaders(): Record<string, string> {
  return {
    'User-Agent': `HZMM/${app.getVersion()}`,
    'Accept': 'application/vnd.github.v3+json'
  }
}

// netRequest rides Electron's net module (Chromium stack) so it follows the
// OS proxy settings — same reason downloadFile does. Redirect hops stay
// pinned to ALLOWED_API_HOSTS, matching the old hand-rolled handler.
async function githubGet<T>(endpoint: string, maxRedirects = 5): Promise<T> {
  const res = await netRequest(`https://api.github.com${endpoint}`, {
    headers: githubHeaders(),
    timeoutMs: REQUEST_TIMEOUT_MS,
    timeoutMessage: 'GitHub API request timed out',
    allowedRedirectHosts: ALLOWED_API_HOSTS,
    maxRedirects
  })
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`GitHub API error: HTTP ${res.statusCode}`)
  }
  try {
    return JSON.parse(res.bodyText)
  } catch {
    throw new Error('Failed to parse GitHub response')
  }
}

// Bug 15 fix: strip pre-release suffix before comparing
function compareVersions(current: string, latest: string): boolean {
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

function isAllowedDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    // github.com asset URLs must belong to OUR repo's releases; the CDN redirect
    // targets (objects./release-assets.githubusercontent.com) serve opaque paths
    // so only their hosts are pinned. Narrows the allow-list to the actual trust
    // boundary. Exact host match — same rule downloadFile enforces per hop.
    if (parsed.hostname === 'github.com') {
      return parsed.pathname.startsWith(`/${REPO}/releases/download/`)
    }
    return ALLOWED_DOWNLOAD_HOSTS.includes(parsed.hostname)
  } catch {
    return false
  }
}

function computeFileHash(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

async function checkForUpdate(): Promise<UpdateCheckInfo> {
  const currentVersion = app.getVersion()
  logger.info(`Checking for updates... current version: ${currentVersion}`)

  const release = await githubGet<GithubRelease | null>(`/repos/${REPO}/releases/latest`)
  if (!release || !release.tag_name) {
    throw new Error('No release found')
  }

  const latestVersion = release.tag_name
  const hasUpdate = compareVersions(currentVersion, latestVersion)

  const asset = release.assets?.find(a => a.name.toLowerCase().endsWith('.exe'))

  // Parse expected SHA256 from release body (format: `SHA256: <hex>`)
  let expectedHash: string | null = null
  if (release.body) {
    const hashMatch = release.body.match(/SHA256:\s*([a-fA-F0-9]{64})/)
    if (hashMatch) expectedHash = hashMatch[1].toLowerCase()
  }

  const result: UpdateCheckInfo = {
    hasUpdate,
    currentVersion,
    latestVersion,
    downloadUrl: asset?.browser_download_url || null,
    expectedHash,
    changelog: release.body || ''
  }

  if (hasUpdate) {
    logger.info(`Update available: ${latestVersion}`)
  } else {
    logger.info(`Already up to date: ${currentVersion}`)
  }

  return result
}

// Remembers the SHA256 verified at download time so app-update:install can
// re-check the on-disk file just before copying it over the running exe —
// closes the download→install TOCTOU on the fixed update path.
let lastVerifiedUpdate: { path: string; hash: string } | null = null

function getVerifiedUpdate(): { path: string; hash: string } | null {
  return lastVerifiedUpdate
}

async function downloadUpdate(
  url: string,
  expectedHash: string | null,
  onProgress: ProgressCallback | null | undefined
): Promise<string> {
  if (!isAllowedDownloadUrl(url)) {
    throw new Error('Update URL is not from an allowed source')
  }

  const destPath = path.join(configStore.getConfigDir(), 'hzmm-update.exe')

  if (fs.existsSync(destPath)) fs.unlinkSync(destPath)

  logger.info(`Downloading update from: ${url}`)
  await downloadFile(url, destPath, onProgress, ALLOWED_DOWNLOAD_HOSTS)

  // SHA256 is mandatory — silently skipping it (the previous fallback) meant
  // a tampered release body without the hash line bypassed integrity entirely.
  // Every release notes body must include a `SHA256: <64hex>` line.
  if (!expectedHash) {
    try { fs.unlinkSync(destPath) } catch { /* best-effort */ }
    throw new Error('Update integrity check failed: release notes missing SHA256 hash')
  }
  const actualHash = await computeFileHash(destPath)
  if (actualHash !== expectedHash.toLowerCase()) {
    fs.unlinkSync(destPath)
    throw new Error(`Update integrity check failed (expected ${expectedHash.slice(0, 16)}..., got ${actualHash.slice(0, 16)}...)`)
  }
  logger.info(`Update integrity verified: SHA256 ${actualHash.slice(0, 16)}...`)
  lastVerifiedUpdate = { path: destPath, hash: actualHash }

  logger.info(`Update downloaded to: ${destPath}`)
  return destPath
}

export { checkForUpdate, downloadUpdate, compareVersions, computeFileHash, getVerifiedUpdate }
