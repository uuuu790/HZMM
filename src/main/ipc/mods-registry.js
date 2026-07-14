import fs from 'fs'
import path from 'path'
import logger from '../services/logger.js'

// Sync mods.txt and mods.json with mod enabled state
function syncUe4ssModRegistry(ue4ssModsPath, modName, enabled) {
  // --- mods.txt ---
  const modsTxtPath = path.join(ue4ssModsPath, 'mods.txt')
  if (fs.existsSync(modsTxtPath)) {
    try {
      let content = fs.readFileSync(modsTxtPath, 'utf-8')
      const regex = new RegExp(`^(${modName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*:\\s*\\d+`, 'm')
      const newLine = `${modName} : ${enabled ? '1' : '0'}`
      // Use function replacements so `$`-sequences in a mod name (e.g. a folder
      // literally named `Mod$1`) are written verbatim instead of being
      // interpreted as regex replacement patterns ($1, $&, $`, …).
      if (regex.test(content)) {
        content = content.replace(regex, () => newLine)
      } else if (enabled) {
        // Only add if enabling — don't clutter mods.txt with disabled entries
        const keybindsMatch = content.match(/^;.*keybinds.*$/im)
        if (keybindsMatch) {
          content = content.replace(keybindsMatch[0], () => `${newLine}\n${keybindsMatch[0]}`)
        } else {
          content = content.trimEnd() + `\n${newLine}\n`
        }
      }
      fs.writeFileSync(modsTxtPath, content, 'utf-8')
    } catch (err) { logger.warn(`Failed to sync mods.txt: ${err.message}`) }
  }

  // --- mods.json ---
  const modsJsonPath = path.join(ue4ssModsPath, 'mods.json')
  if (fs.existsSync(modsJsonPath)) {
    try {
      const mods = JSON.parse(fs.readFileSync(modsJsonPath, 'utf-8'))
      if (!Array.isArray(mods)) { logger.warn('mods.json is not an array, skipping sync'); return }
      const existing = mods.find(m => m.mod_name === modName)
      if (existing) {
        existing.mod_enabled = enabled
      } else if (enabled) {
        mods.push({ mod_name: modName, mod_enabled: true })
      }
      fs.writeFileSync(modsJsonPath, JSON.stringify(mods, null, 4), 'utf-8')
    } catch (err) { logger.warn(`Failed to sync mods.json: ${err.message}`) }
  }
}

// Remove mod entry from mods.txt and mods.json
function removeFromUe4ssModRegistry(ue4ssModsPath, modName) {
  const modsTxtPath = path.join(ue4ssModsPath, 'mods.txt')
  if (fs.existsSync(modsTxtPath)) {
    try {
      let content = fs.readFileSync(modsTxtPath, 'utf-8')
      // Match trailing CR + LF so UE4SS-written CRLF files don't leave an orphan \r
      const regex = new RegExp(`^${modName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*\\d+[ \\t]*\\r?\\n?`, 'm')
      content = content.replace(regex, '')
      fs.writeFileSync(modsTxtPath, content, 'utf-8')
    } catch (err) { logger.warn(`Failed to remove from mods.txt: ${err.message}`) }
  }

  const modsJsonPath = path.join(ue4ssModsPath, 'mods.json')
  if (fs.existsSync(modsJsonPath)) {
    try {
      const mods = JSON.parse(fs.readFileSync(modsJsonPath, 'utf-8'))
      if (!Array.isArray(mods)) { logger.warn('mods.json is not an array, skipping remove'); return }
      const filtered = mods.filter(m => m.mod_name !== modName)
      fs.writeFileSync(modsJsonPath, JSON.stringify(filtered, null, 4), 'utf-8')
    } catch (err) { logger.warn(`Failed to remove from mods.json: ${err.message}`) }
  }
}

// Read the set of UE4SS mod names marked enabled in the registry files
// (mods.json preferred, mods.txt as fallback). UE4SS itself uses these as its
// load list, and a mod can be enabled here without an `enabled.txt` marker
// (e.g. enabled outside HZMM or shipped pre-enabled) — so the scanner consults
// this alongside enabled.txt to avoid showing a loaded mod as "disabled".
function readUe4ssEnabledNames(ue4ssModsPath) {
  const enabled = new Set()
  const jsonPath = path.join(ue4ssModsPath, 'mods.json')
  if (fs.existsSync(jsonPath)) {
    try {
      const mods = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
      if (Array.isArray(mods)) {
        for (const m of mods) {
          if (m && typeof m.mod_name === 'string' && m.mod_enabled === true) enabled.add(m.mod_name)
        }
      }
    } catch { /* corrupt mods.json — ignore, fall back to enabled.txt / mods.txt */ }
  }
  const txtPath = path.join(ue4ssModsPath, 'mods.txt')
  if (fs.existsSync(txtPath)) {
    try {
      const content = fs.readFileSync(txtPath, 'utf-8')
      for (const line of content.split(/\r?\n/)) {
        // `Name : 1` = enabled. Skip comment lines (`;`) and disabled (`: 0`).
        const m = line.match(/^([^:;]+?)\s*:\s*1\b/)
        if (m) enabled.add(m[1].trim())
      }
    } catch { /* unreadable mods.txt — ignore */ }
  }
  return enabled
}

export { syncUe4ssModRegistry, removeFromUe4ssModRegistry, readUe4ssEnabledNames }
