// Mod version retention for one-click rollback. Before nexus:update-file
// replaces a mod, the outgoing files are archived under
// <configDir>/mod-versions/<modId>/<timestamp>/ with a manifest; only the
// newest KEEP_VERSIONS snapshots per mod are retained (paks can be large).
//
// Pure fs + injected paths — no configStore/Electron — so unit tests drive
// everything against temp dirs. IPC handlers live in nexus.js.

import fs from 'fs'
import path from 'path'
import { assertSafeSegment } from '../services/path-safety.js'
import { copyDirSync } from './mods-install.js'
import logger from '../services/logger.js'

export const KEEP_VERSIONS = 2

// A modern UE "pak mod" is not one file: the IoStore layout splits it into
// <stem>.pak + <stem>.ucas + <stem>.utoc, and the engine pairs them BY FILENAME.
// Archive, restore, rename or delete only the .pak and the mod is left with a
// stale index against fresh assets (or vice versa) — the mod's content silently
// fails to load, or the game crashes resolving it.
//
// Only the .pak carries the `.disabled` suffix when a mod is toggled off; the
// siblings keep their plain names. Matching is case-insensitive because mod
// authors ship `Mod_P.PAK` and the archive analyzer already accepts those.
export const PAK_SIBLING_EXTS = ['.pak', '.ucas', '.utoc']

// Strip `.disabled` and the pak extension to get the stem the siblings share.
export function pakStem(fileName) {
  return String(fileName).replace(/\.disabled$/i, '').replace(/\.pak$/i, '')
}

// Every file in `dir` that belongs to the same mod as `pakFileName`, the pak
// itself included. Returns plain file names, or [] when the dir is unreadable.
export function listPakSiblings(dir, pakFileName) {
  const stem = pakStem(pakFileName).toLowerCase()
  if (!stem) return []
  let names = []
  try { names = fs.readdirSync(dir) } catch { return [] }
  return names.filter((n) => {
    const bare = n.replace(/\.disabled$/i, '')
    const ext = path.extname(bare).toLowerCase()
    if (!PAK_SIBLING_EXTS.includes(ext)) return false
    return bare.slice(0, -ext.length).toLowerCase() === stem
  })
}

// Locate a receipt-recorded PAK on disk in whatever form it currently has.
// Candidate names mirror rotateModsToBackup / mods-update-state.
function findPakFile(paksPaths, name) {
  for (const base of [`${name}_P.pak`, `${name}.pak`]) {
    for (const dir of paksPaths || []) {
      if (fs.existsSync(path.join(dir, base))) return { dir, onDiskName: base }
      if (fs.existsSync(path.join(dir, `${base}.disabled`))) return { dir, onDiskName: `${base}.disabled` }
    }
  }
  return null
}

// Delete every on-disk variant (enabled/disabled) of a receipt PAK name.
// Used by rollback to clear the current version before copying the archive in.
export function removePakVariants(paksPaths, name) {
  let removed = 0
  for (const base of [`${name}_P.pak`, `${name}.pak`]) {
    for (const dir of paksPaths || []) {
      // listPakSiblings covers the .pak, its .disabled twin AND the .ucas/.utoc
      // that travel with it. Removing the pak alone left the IoStore siblings
      // behind, so the next install/rollback mixed one version's index with
      // another version's assets.
      for (const variant of listPakSiblings(dir, base)) {
        const p = path.join(dir, variant)
        if (!fs.existsSync(p)) continue
        try {
          fs.unlinkSync(p)
          removed++
        } catch (err) {
          logger.warn(`mod-versions: could not remove ${variant}: ${err.message}`)
        }
      }
    }
  }
  return removed
}

// Keep only the newest `keep` snapshots for one mod (dir names are epoch ms).
export function pruneModVersions(modVersionsDir, keep = KEEP_VERSIONS) {
  let dirs = []
  try { dirs = fs.readdirSync(modVersionsDir).filter(d => /^\d+$/.test(d)) } catch { return 0 }
  dirs.sort((a, b) => Number(b) - Number(a))
  let pruned = 0
  for (const d of dirs.slice(keep)) {
    try {
      fs.rmSync(path.join(modVersionsDir, d), { recursive: true, force: true })
      pruned++
    } catch (err) {
      logger.warn(`mod-versions: prune failed for ${d}: ${err.message}`)
    }
  }
  return pruned
}

// Snapshot the CURRENT on-disk files of a receipt before an update replaces
// them. Returns { dir, entries } or null when nothing was found to archive.
// `prune: false` defers retention pruning to the caller — the update flow
// prunes only AFTER the install succeeds, so a failed attempt (whose snapshot
// it deletes again) can never evict a genuinely older version's rollback slot.
export function archiveModVersion({ paksPaths, ue4ssModsPath }, retentionRoot, receipt, now = Date.now(), { prune = true } = {}) {
  if (!receipt || !Number.isInteger(receipt.modId)) return null
  const snapshotDir = path.join(retentionRoot, String(receipt.modId), String(now))
  const entries = []
  for (const lm of Array.isArray(receipt.localMods) ? receipt.localMods : []) {
    if (!lm || !lm.name || !lm.modType) continue
    try { assertSafeSegment('modName', lm.name) } catch { continue }
    try {
      if (lm.modType === 'PAK') {
        const found = findPakFile(paksPaths, lm.name)
        if (!found) continue
        const outDir = path.join(snapshotDir, 'paks')
        fs.mkdirSync(outDir, { recursive: true })
        // Archive the whole file set, not just the .pak — a rollback that
        // restores a stale index over fresh .ucas/.utoc breaks the mod.
        // `filename` stays for snapshots written before `files` existed.
        const files = listPakSiblings(found.dir, found.onDiskName)
        for (const fname of files) {
          fs.copyFileSync(path.join(found.dir, fname), path.join(outDir, fname))
        }
        entries.push({ kind: 'PAK', filename: found.onDiskName, files, name: lm.name })
      } else if (lm.modType === 'UE4SS' && ue4ssModsPath) {
        const modDir = path.join(ue4ssModsPath, lm.name)
        let isDir = false
        try { isDir = fs.statSync(modDir).isDirectory() } catch { /* not on disk */ }
        if (!isDir) continue
        copyDirSync(modDir, path.join(snapshotDir, 'ue4ss', lm.name))
        entries.push({ kind: 'UE4SS', name: lm.name })
      }
    } catch (err) {
      logger.warn(`mod-versions: archive failed for ${lm.name}: ${err.message}`)
    }
  }
  if (entries.length === 0) {
    try { fs.rmSync(snapshotDir, { recursive: true, force: true }) } catch { /* nothing landed */ }
    return null
  }
  const manifest = {
    type: 'mod-version',
    version: 1,
    modId: receipt.modId,
    fileId: receipt.fileId ?? null,
    modVersion: receipt.version ?? null,
    savedAt: now,
    entries,
  }
  fs.writeFileSync(path.join(snapshotDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  if (prune) pruneModVersions(path.join(retentionRoot, String(receipt.modId)))
  logger.info(`mod-versions: archived mod ${receipt.modId} (${entries.length} entries)`)
  return { dir: snapshotDir, entries: entries.length }
}

// Enumerate every retained snapshot: { [modId]: [{ dir, version, fileId,
// savedAt }] } newest first. (IPC/structured-clone keys are strings.)
export function listModVersions(retentionRoot) {
  const out = {}
  let modDirs = []
  try { modDirs = fs.readdirSync(retentionRoot).filter(d => /^\d+$/.test(d)) } catch { return out }
  for (const modId of modDirs) {
    const modDir = path.join(retentionRoot, modId)
    let snaps = []
    try { snaps = fs.readdirSync(modDir).filter(d => /^\d+$/.test(d)) } catch { continue }
    const versions = []
    for (const snap of snaps) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(modDir, snap, 'manifest.json'), 'utf-8'))
        versions.push({
          dir: path.join(modDir, snap),
          version: manifest.modVersion ?? null,
          fileId: manifest.fileId ?? null,
          savedAt: manifest.savedAt || Number(snap),
        })
      } catch { /* corrupt/partial snapshot — skip */ }
    }
    if (versions.length > 0) {
      versions.sort((a, b) => b.savedAt - a.savedAt)
      out[modId] = versions
    }
  }
  return out
}

// Replace the mod's current files with an archived snapshot. Every name from
// the manifest is re-validated (the retention dir is user-modifiable on disk).
// Returns { modId, fileId, version, localMods } for the receipt rewrite.
export function restoreArchivedVersion({ paksPaths, ue4ssModsPath, primaryPaksPath }, snapshotDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(snapshotDir, 'manifest.json'), 'utf-8'))
  const localMods = []
  for (const entry of Array.isArray(manifest.entries) ? manifest.entries : []) {
    if (!entry || !entry.kind) continue
    try {
      if (entry.kind === 'PAK') {
        assertSafeSegment('filename', entry.filename)
        assertSafeSegment('modName', entry.name)
        // Snapshots written before the sibling fix only carry `filename`.
        const names = Array.isArray(entry.files) && entry.files.length ? entry.files : [entry.filename]
        const present = names.filter(n => typeof n === 'string' && fs.existsSync(path.join(snapshotDir, 'paks', n)))
        if (present.length === 0) continue
        removePakVariants(paksPaths, entry.name)
        for (const fname of present) {
          assertSafeSegment('filename', fname)
          fs.copyFileSync(path.join(snapshotDir, 'paks', fname), path.join(primaryPaksPath, fname))
        }
        localMods.push({ modType: 'PAK', name: entry.name })
      } else if (entry.kind === 'UE4SS' && ue4ssModsPath) {
        assertSafeSegment('modName', entry.name)
        const src = path.join(snapshotDir, 'ue4ss', entry.name)
        if (!fs.existsSync(src)) continue
        const dest = path.join(ue4ssModsPath, entry.name)
        fs.rmSync(dest, { recursive: true, force: true })
        copyDirSync(src, dest)
        localMods.push({ modType: 'UE4SS', name: entry.name })
      }
    } catch (err) {
      logger.warn(`mod-versions: restore skipped ${entry.name || entry.filename}: ${err.message}`)
    }
  }
  return {
    modId: manifest.modId,
    fileId: manifest.fileId ?? null,
    version: manifest.modVersion ?? null,
    localMods,
  }
}
