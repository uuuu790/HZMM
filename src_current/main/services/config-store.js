import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'

let CONFIG_DIR = null
let CONFIG_FILE = null

function ensurePaths() {
  if (!CONFIG_DIR) {
    CONFIG_DIR = join(app.getPath('appData'), 'hzmm-manager')
    CONFIG_FILE = join(CONFIG_DIR, 'config.json')
  }
}

let cache = null

function ensureDir() {
  ensurePaths()
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

function load() {
  if (cache) return cache
  ensureDir()
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      cache = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
    } else {
      cache = {}
    }
  } catch {
    cache = {}
  }
  return cache
}

function save() {
  ensureDir()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cache, null, 2), 'utf-8')
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
