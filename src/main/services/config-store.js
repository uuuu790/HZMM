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

function load() {
  if (cache) return cache
  ensureDir()
  if (!fs.existsSync(CONFIG_FILE)) {
    cache = {}
    return cache
  }
  try {
    cache = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
  } catch {
    // The file exists but is corrupt. Preserve it under a timestamped name
    // before falling back to {} — otherwise the next set() would overwrite the
    // (possibly recoverable) original with an empty object, silently wiping
    // gamePath / profiles / Nexus receipts / API key. No logger import here to
    // avoid a config-store <-> logger cycle; the backup file is the signal.
    try {
      fs.renameSync(CONFIG_FILE, `${CONFIG_FILE}.corrupt-${Date.now()}`)
    } catch { /* best-effort — fall through to empty cache */ }
    cache = {}
  }
  return cache
}

let cache = null

function save() {
  ensureDir()
  // Atomic write: tmp + rename. A power-cycle / hard-kill mid-write
  // would otherwise leave a truncated config.json, and load()'s silent
  // JSON.parse catch resets cache to {} — wiping the user's settings.
  const tmpPath = CONFIG_FILE + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), 'utf-8')
  fs.renameSync(tmpPath, CONFIG_FILE)
}

function get(key, defaultValue = null) {
  const data = load()
  // Object.hasOwn (not `data[key] !== undefined`) so keys like '__proto__' /
  // 'constructor' resolve to the default instead of an inherited prototype prop.
  return Object.hasOwn(data, key) ? data[key] : defaultValue
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
