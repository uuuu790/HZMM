import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import { getAllPaksPaths } from '../services/steam-detector.js'
import { readPakIndex } from '../services/pak-parser.js'
import logger from '../services/logger.js'

function registerConflictsIpc() {
  ipcMain.handle('conflicts:scan', () => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return []

    const paksPaths = getAllPaksPaths(gamePath)
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

        const entries = readPakIndex(filePath)
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

    logger.info(`Conflict scan complete: ${conflicts.length} conflicts found across ${paksPaths.length} directories`)
    return conflicts
  })
}

export { registerConflictsIpc }
