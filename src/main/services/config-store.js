import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'

const CONFIG_DIR = join(app.getPath('appData'), 'hzmm-manager')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

let cache = null

function ensureDir() {
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

export default { get, set, remove, CONFIG_DIR }
