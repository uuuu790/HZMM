import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import { getAllPaksPaths } from '../services/steam-detector.js'
import { readPakIndex } from '../services/pak-parser.js'
import logger from '../services/logger.js'

// Pure conflict detection: walk paksPaths, collect every PAK's resource list,
// flag resources that appear in more than one PAK. Skips engine packs
// (`pakchunk*` / `global*`) and disabled `.pak.disabled` files.
//
// `readIndex` is injectable so unit tests can stub the binary PAK parser —
// the conflict-collection logic itself doesn't depend on file format.
//
// Returns: `[{ resource: string, mods: string[] }]` (only entries with >1 mod).
//
// readPakIndex does a synchronous footer read + full index parse on the main
// thread, so unchanged paks are cached by path+mtime+size to keep repeat scans
// cheap. Only the real parser is cached; injected test readers bypass the cache.
const pakIndexCache = new Map()

function readPakIndexCached(filePath, stat) {
  const key = `${filePath}:${stat.mtimeMs}:${stat.size}`
  const hit = pakIndexCache.get(key)
  if (hit) return hit
  const entries = readPakIndex(filePath)
  pakIndexCache.set(key, entries)
  return entries
}

export function findConflicts(paksPaths, readIndex = readPakIndex) {
  const modResources = new Map()

  for (const paksDir of paksPaths) {
    if (!fs.existsSync(paksDir)) continue

    const files = fs.readdirSync(paksDir)
    for (const file of files) {
      if (!file.endsWith('.pak')) continue
      const lower = file.toLowerCase()
      if (lower.startsWith('pakchunk') || lower.startsWith('global')) continue

      const filePath = path.join(paksDir, file)
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) continue

      const entries = readIndex === readPakIndex
        ? readPakIndexCached(filePath, stat)
        : readIndex(filePath)
      for (const entry of entries) {
        if (!modResources.has(entry)) {
          modResources.set(entry, [])
        }
        modResources.get(entry).push(file)
      }
    }
  }

  const conflicts = []
  for (const [resource, mods] of modResources) {
    if (mods.length > 1) {
      conflicts.push({ resource, mods })
    }
  }
  return conflicts
}

function registerConflictsIpc() {
  ipcMain.handle('conflicts:scan', () => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return []
    const paksPaths = getAllPaksPaths(gamePath)
    const conflicts = findConflicts(paksPaths)
    logger.info(`Conflict scan complete: ${conflicts.length} conflicts found across ${paksPaths.length} directories`)
    return conflicts
  })
}

export { registerConflictsIpc }
