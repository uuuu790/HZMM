import { app } from 'electron'
import { join } from 'path'
import os from 'os'
import fs from 'fs'

let CONFIG_DIR = null
let CONFIG_FILE = null

// Resolve %AppData%\Roaming directly via env / homedir, not via
// app.getPath('appData'). Reason: electron-builder portable builds and
// app.setName() timing in some Electron versions can momentarily shift
// the Electron-resolved app path during startup, and a stale resolution
// would land us writing/reading from a different folder across upgrades.
// process.env.APPDATA is the same directory Electron normally returns,
// just with no Electron lifecycle dependency.
function ensurePaths() {
  if (!CONFIG_DIR) {
    const appData = process.env.APPDATA
      || (app && typeof app.getPath === 'function' ? app.getPath('appData') : null)
      || join(os.homedir(), 'AppData', 'Roaming')
    CONFIG_DIR = join(appData, 'hzmm-manager')
    CONFIG_FILE = join(CONFIG_DIR, 'config.json')
  }
}

function ensureDir() {
  ensurePaths()
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

let cache = null

// Latched when config.json EXISTS but could not be read (I/O error, AV lock,
// permissions). Distinct from "corrupt content": we must never overwrite a file
// we failed to read, or one transient error silently destroys every setting the
// user has — game path, Nexus API key, profiles, the lot.
let loadFailed = false

// NOTE: no logger import here. services/logger.js imports THIS module for
// getConfigDir(), so importing it back would be a require cycle. console goes
// to the same place during main-process startup.
function quarantineCorruptConfig(reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = `${CONFIG_FILE}.corrupt-${stamp}`
  try {
    fs.renameSync(CONFIG_FILE, target)
    console.error(`[config-store] ${reason} — quarantined to ${target}, starting fresh`)
  } catch (err) {
    console.error(`[config-store] ${reason} — failed to quarantine it (${err.message})`)
  }
}

function load() {
  if (cache) return cache
  ensureDir()

  if (!fs.existsSync(CONFIG_FILE)) {
    cache = {}
    return cache
  }

  let raw
  try {
    raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
  } catch (err) {
    console.error(`[config-store] cannot read config.json (${err.message}) — settings are read-only for this session`)
    loadFailed = true
    cache = {}
    return cache
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    // Content is genuinely unusable, so replacing it is correct — but keep the
    // original around instead of destroying it, in case the user (or we) can
    // salvage the game path / API key out of it.
    quarantineCorruptConfig(`config.json is not valid JSON (${err.message})`)
    cache = {}
    return cache
  }

  // A JSON document can legally be null, a string, a number or an array — none
  // of which support the key/value access every caller assumes.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    quarantineCorruptConfig('config.json does not contain a JSON object')
    cache = {}
    return cache
  }

  cache = parsed
  return cache
}

function save() {
  if (loadFailed) {
    // Refusing is the whole point: the on-disk file holds settings we could not
    // read, and writing our empty view over it would be the data loss.
    throw new Error('Refusing to write settings: the existing config.json could not be read')
  }
  ensureDir()
  // Atomic write: tmp + fsync + rename. A power-cycle / hard-kill mid-write
  // would otherwise leave a truncated config.json. The fsync matters as much as
  // the rename — without it the rename can land while the contents are still in
  // the page cache, producing exactly the truncated file this guards against.
  const tmpPath = CONFIG_FILE + '.tmp'
  const fd = fs.openSync(tmpPath, 'w')
  try {
    fs.writeFileSync(fd, JSON.stringify(cache, null, 2), 'utf-8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmpPath, CONFIG_FILE)
}

function get(key, defaultValue = null) {
  const data = load()
  return data[key] !== undefined ? data[key] : defaultValue
}

function set(key, value) {
  load()
  cache[key] = value
  save()
}

function remove(key) {
  load()
  delete cache[key]
  save()
}

function getConfigDir() {
  ensurePaths()
  return CONFIG_DIR
}

export default { get, set, remove, getConfigDir }
