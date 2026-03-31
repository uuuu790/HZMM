import fs from 'fs'
import path from 'path'
import configStore from './config-store.js'

const LOG_FILE = path.join(configStore.CONFIG_DIR, 'hzmm.log')
const OLD_LOG_FILE = path.join(configStore.CONFIG_DIR, 'hzmm.log.old')
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

function ensureDir() {
  const dir = path.dirname(LOG_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function rotate() {
  try {
    const stat = fs.statSync(LOG_FILE)
    if (stat.size >= MAX_SIZE) {
      if (fs.existsSync(OLD_LOG_FILE)) fs.unlinkSync(OLD_LOG_FILE)
      fs.renameSync(LOG_FILE, OLD_LOG_FILE)
    }
  } catch {
    // File doesn't exist yet, nothing to rotate
  }
}

function timestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function write(level, message) {
  ensureDir()
  rotate()
  const line = `[${timestamp()}] [${level}] ${message}\n`
  fs.appendFileSync(LOG_FILE, line, 'utf-8')
}

function readRecent(lineCount = 100) {
  if (!fs.existsSync(LOG_FILE)) return []
  const content = fs.readFileSync(LOG_FILE, 'utf-8')
  const lines = content.split('\n').filter(Boolean)
  return lines.slice(-lineCount)
}

const logger = {
  info: (msg) => write('INFO', msg),
  warn: (msg) => write('WARN', msg),
  error: (msg) => write('ERROR', msg),
  getPath: () => {
    ensureDir()
    if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '', 'utf-8')
    return LOG_FILE
  },
  readRecent
}

export default logger
