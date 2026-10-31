// Mod version retention for one-click rollback. Before nexus:update-file
// replaces a mod, the outgoing files are archived under
// <configDir>/mod-versions/<modId>/<timestamp>/ with a manifest; only the
// newest KEEP_VERSIONS snapshots per mod are retained (paks can be large).
//
// Pure fs + injected paths — no configStore/Electron — so unit tests drive
// everything against temp dirs. IPC handlers live in nexus.ts.

import fs from 'fs'
import path from 'path'
import { assertSafeSegment } from '../services/path-safety'
import { copyDirSync } from './mods-install'
import logger from '../services/logger'
import { isPakFormOfMod, type PakLocations } from './mods-order'
import type { LocalModRef, ModType, ModVersionInfo, NexusInstallReceipt } from './types'

export const KEEP_VERSIONS = 2

/** One archived pak / UE4SS folder in a snapshot manifest. */
interface VersionEntry {
  kind: ModType
  name: string
  /** PAK only: the on-disk name it had (may be `.disabled`). */
  filename?: string
  /** PAK only: every archived file, the pak plus its .ucas/.utoc (older manifests: just `filename`). */
  files?: string[]
}

interface ModVersionManifest {
  type: 'mod-version'
  version: 1
  modId: number
  fileId: number | null
  modVersion: string | null
  savedAt: number
  entries: VersionEntry[]
}

const IOSTORE_FILE_RE = /\.(ucas|utoc)(\.disabled)?$/i

// Every on-disk form of PAK mod `name` (pak/ucas/utoc, enabled or disabled,
// with or without a load-order prefix — isPakFormOfMod, the install rotation's
// identity rule), as full paths. A folder listed twice (case, trailing
// separator) is read once.
function pakFormsOnDisk(paksPaths: readonly string[] | null | undefined, name: string): string[] {
  const out: string[] = []
  const seenDirs = new Set<string>()
  for (const dir of paksPaths || []) {
    const dirKey = path.resolve(dir).toLowerCase()
    if (seenDirs.has(dirKey)) continue
    seenDirs.add(dirKey)
    let files: string[] = []
    try { files = fs.readdirSync(dir) } catch { continue }
    for (const f of files) if (isPakFormOfMod(f, name)) out.push(path.join(dir, f))
  }
  return out
}

// Delete every on-disk form of a receipt PAK name.
export function removePakVariants(paksPaths: string[] | null | undefined, name: string): number {
  let removed = 0
  for (const p of pakFormsOnDisk(paksPaths, name)) {
    try {
      fs.unlinkSync(p)
      removed++
    } catch (err) {
      logger.warn(`mod-versions: could not remove ${path.basename(p)}: ${(err as Error).message}`)
    }
  }
  return removed
}

// Keep only the newest `keep` snapshots for one mod (dir names are epoch ms).
export function pruneModVersions(modVersionsDir: string, keep = KEEP_VERSIONS): number {
  let dirs: string[] = []
  try { dirs = fs.readdirSync(modVersionsDir).filter(d => /^\d+$/.test(d)) } catch { return 0 }
  dirs.sort((a, b) => Number(b) - Number(a))
  let pruned = 0
  for (const d of dirs.slice(keep)) {
    try {
      fs.rmSync(path.join(modVersionsDir, d), { recursive: true, force: true })
      pruned++
    } catch (err) {
      logger.warn(`mod-versions: prune failed for ${d}: ${(err as Error).message}`)
    }
  }
  return pruned
}

// Snapshot the CURRENT on-disk files of a receipt before an update replaces
// them. Returns { dir, entries } or null when nothing was found to archive.
// `prune: false` defers retention pruning to the caller — the update flow
// prunes only AFTER the install succeeds, so a failed attempt (whose snapshot
// it deletes again) can never evict a genuinely older version's rollback slot.
export function archiveModVersion(
  { paksPaths, ue4ssModsPath }: PakLocations,
  retentionRoot: string,
  receipt: NexusInstallReceipt | null | undefined,
  now = Date.now(),
  { prune = true }: { prune?: boolean } = {},
): { dir: string; entries: number } | null {
  if (!receipt || !Number.isInteger(receipt.modId)) return null
  const snapshotDir = path.join(retentionRoot, String(receipt.modId), String(now))
  const entries: VersionEntry[] = []
  for (const lm of Array.isArray(receipt.localMods) ? receipt.localMods : []) {
    if (!lm || !lm.name || !lm.modType) continue
    try { assertSafeSegment('modName', lm.name) } catch { continue }
    try {
      if (lm.modType === 'PAK') {
        // Every form of the mod, so a rollback restores the whole set: the
        // pak with its .ucas/.utoc, enabled or disabled, load-order prefix
        // (z1_Cool_P.pak) or not. One copy per file name: the first folder wins.
        const found = new Map<string, string>()
        for (const p of pakFormsOnDisk(paksPaths, lm.name)) {
          const key = path.basename(p).toLowerCase()
          if (!found.has(key)) found.set(key, p)
        }
        if (found.size === 0) continue
        const files = [...found.values()].map(p => path.basename(p))
        const outDir = path.join(snapshotDir, 'paks')
        fs.mkdirSync(outDir, { recursive: true })
        for (const p of found.values()) fs.copyFileSync(p, path.join(outDir, path.basename(p)))
        const filename = files.find(f => !IOSTORE_FILE_RE.test(f)) ?? files[0]
        entries.push({ kind: 'PAK', filename, files, name: lm.name })
      } else if (lm.modType === 'UE4SS' && ue4ssModsPath) {
        const modDir = path.join(ue4ssModsPath, lm.name)
        let isDir = false
        try { isDir = fs.statSync(modDir).isDirectory() } catch { /* not on disk */ }
        if (!isDir) continue
        copyDirSync(modDir, path.join(snapshotDir, 'ue4ss', lm.name))
        entries.push({ kind: 'UE4SS', name: lm.name })
      }
    } catch (err) {
      logger.warn(`mod-versions: archive failed for ${lm.name}: ${(err as Error).message}`)
    }
  }
  if (entries.length === 0) {
    try { fs.rmSync(snapshotDir, { recursive: true, force: true }) } catch { /* nothing landed */ }
    return null
  }
  const manifest: ModVersionManifest = {
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
export function listModVersions(retentionRoot: string): Record<string, ModVersionInfo[]> {
  const out: Record<string, ModVersionInfo[]> = {}
  let modDirs: string[] = []
  try { modDirs = fs.readdirSync(retentionRoot).filter(d => /^\d+$/.test(d)) } catch { return out }
  for (const modId of modDirs) {
    const modDir = path.join(retentionRoot, modId)
    let snaps: string[] = []
    try { snaps = fs.readdirSync(modDir).filter(d => /^\d+$/.test(d)) } catch { continue }
    const versions: ModVersionInfo[] = []
    for (const snap of snaps) {
      try {
        const manifest: Partial<ModVersionManifest> = JSON.parse(fs.readFileSync(path.join(modDir, snap, 'manifest.json'), 'utf-8'))
        // Which local mods the snapshot holds, so the renderer offers it only
        // on those mods' cards (a mod page can have several variants).
        const mods: LocalModRef[] = []
        for (const e of (Array.isArray(manifest.entries) ? manifest.entries : []) as Array<Partial<VersionEntry> | null>) {
          if (e && (e.kind === 'PAK' || e.kind === 'UE4SS') && typeof e.name === 'string' && e.name) mods.push({ name: e.name, modType: e.kind })
        }
        versions.push({
          dir: path.join(modDir, snap),
          version: manifest.modVersion ?? null,
          fileId: manifest.fileId ?? null,
          savedAt: manifest.savedAt || Number(snap),
          mods,
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
// the manifest is re-validated (the retention dir is user-modifiable on disk);
// invalid entries are skipped. All or nothing otherwise: the current files are
// first renamed aside (a pak or DLL the running game holds fails right there),
// then the archive is copied in. On any failure every step is undone and this
// throws, so the caller keeps both the current files and the snapshot.
// `clearPakNames`: more PAK mod names whose current files go aside with them.
// Returns { modId, fileId, version, localMods } for the receipt rewrite.
export function restoreArchivedVersion(
  { paksPaths, ue4ssModsPath, primaryPaksPath }: PakLocations & { primaryPaksPath: string },
  snapshotDir: string,
  { clearPakNames = [] }: { clearPakNames?: readonly string[] } = {},
): { modId: number; fileId: number | null; version: string | null; localMods: LocalModRef[] } {
  // The retention dir is user-modifiable: every entry field is checked below.
  const manifest: { modId: number; fileId?: number | null; modVersion?: string | null; entries?: unknown } =
    JSON.parse(fs.readFileSync(path.join(snapshotDir, 'manifest.json'), 'utf-8'))
  const localMods: LocalModRef[] = []
  const pakNames: string[] = []
  const copies: Array<{ src: string; dest: string; dir: boolean }> = []
  const seen = new Set<string>()
  const pakDests = new Set<string>()
  // Written before `files` existed: the snapshot holds only these mods' .pak.
  const legacyPakNames: string[] = []
  for (const entry of (Array.isArray(manifest.entries) ? manifest.entries : []) as Array<Partial<VersionEntry> | null>) {
    if (!entry || (entry.kind !== 'PAK' && entry.kind !== 'UE4SS')) continue
    const name = entry.name
    const pakFiles = new Map<string, string>()
    try {
      assertSafeSegment('modName', name)
      if (entry.kind === 'PAK') {
        for (const f of Array.isArray(entry.files) ? entry.files : [entry.filename]) {
          assertSafeSegment('filename', f)
          if (!isPakFormOfMod(f, name)) throw new Error(`filename: ${f} is not a file of ${name}`)
          pakFiles.set(f.toLowerCase(), f)
        }
      }
    } catch (err) {
      logger.warn(`mod-versions: restore skipped ${name || entry.filename}: ${(err as Error).message}`)
      continue
    }
    const key = `${entry.kind}:${name.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    if (entry.kind === 'PAK') {
      if (pakFiles.size === 0) continue
      for (const [lower, f] of pakFiles) {
        // Two receipt names can share a file (Cool / Cool_P → Cool_P.pak): copy it once.
        if (pakDests.has(lower)) continue
        pakDests.add(lower)
        copies.push({ src: path.join(snapshotDir, 'paks', f), dest: path.join(primaryPaksPath, f), dir: false })
      }
      if (!Array.isArray(entry.files)) legacyPakNames.push(name)
      pakNames.push(name)
    } else {
      if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')
      copies.push({ src: path.join(snapshotDir, 'ue4ss', name), dest: path.join(ue4ssModsPath, name), dir: true })
    }
    localMods.push({ modType: entry.kind, name })
  }
  if (localMods.length === 0) throw new Error('Nothing in this snapshot can be restored')
  for (const { src } of copies) {
    if (!fs.existsSync(src)) throw new Error(`Snapshot is incomplete: ${path.basename(src)} is missing`)
  }
  // The current forms of every PAK name involved go aside first.
  const pakDirs = [...(paksPaths || []), primaryPaksPath]
  const clearing = [...new Set([...pakNames, ...clearPakNames].flatMap(name => pakFormsOnDisk(pakDirs, name)))]
  // An older snapshot can't say whether its pak had .ucas/.utoc beside it:
  // clearing the current ones could leave the old pak without its containers,
  // keeping them would pair it with the new ones. Either breaks the mod.
  if (legacyPakNames.some(name => pakFormsOnDisk(pakDirs, name).some(p => IOSTORE_FILE_RE.test(p)))) {
    throw new Error('This snapshot was saved before HZMM kept a pak\'s .ucas/.utoc files, so it cannot roll back this IoStore mod. Reinstall that version from Nexus instead.')
  }

  const stamp = Date.now()
  // lstat: a dangling link at a destination still counts as in the way.
  const exists = (p: string): boolean => { try { fs.lstatSync(p); return true } catch { return false } }
  const undo: Array<() => void> = []
  const asides: string[] = []
  const moveAside = (from: string, to: string): void => {
    fs.renameSync(from, to)
    undo.push(() => fs.renameSync(to, from))
    asides.push(to)
  }
  try {
    for (const p of clearing) moveAside(p, `${p}.hzmm-old-${stamp}`)
    for (const { dest, dir } of copies) {
      // A UE4SS folder goes aside OUTSIDE Mods: a leftover copy in there
      // (enabled.txt and all) would be loaded as a second mod.
      if (dir && exists(dest)) {
        moveAside(dest, path.join(path.dirname(path.dirname(dest)), `.hzmm-old-${stamp}-${path.basename(dest)}`))
      }
    }
    for (const { src, dest, dir } of copies) {
      // Only ever delete (on undo) what this restore created.
      if (exists(dest)) throw new Error(`${path.basename(dest)} is in the way`)
      undo.push(() => fs.rmSync(dest, { recursive: true, force: true }))
      if (dir) copyDirSync(src, dest)
      else fs.copyFileSync(src, dest)
    }
  } catch (err) {
    for (const step of undo.reverse()) {
      try { step() } catch (undoErr) {
        logger.error(`mod-versions: could not undo a rollback step: ${(undoErr as Error).message}`)
      }
    }
    logger.warn(`mod-versions: restore of ${snapshotDir} failed: ${(err as Error).message}`)
    throw err
  }
  for (const p of asides) {
    try { fs.rmSync(p, { recursive: true, force: true }) } catch (err) {
      logger.warn(`mod-versions: could not remove ${p}: ${(err as Error).message}`)
    }
  }
  return {
    modId: manifest.modId,
    fileId: manifest.fileId ?? null,
    version: manifest.modVersion ?? null,
    localMods,
  }
}
