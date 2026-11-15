// Updates whose new version lands under a NEW pak filename.
//
// Some authors put the version in the pak name ("bailing_4TierVehicleCamera_
// 1.1X_v1.2.1_P.pak" -> "..._1.1Z_v1.3.0_P.pak"). The installer's rotation only
// replaces on-disk forms of the INCOMING pak's own name, so after such an update
// the old version would stay mounted next to the new one. For a confirmed
// update (the incoming file is in the installed file's Nexus family, and the
// outgoing version was archived for rollback) the update flow pairs each
// outgoing pak the new version did not re-land with the pak that replaced it,
// removes the outgoing files, moves its filename-keyed stores (profiles, custom
// name, hybrid links, receipt) to the new name, and re-points the captured
// enabled / load-order state so restoreModState re-applies it to the new pak.

import fs from 'fs'
import path from 'path'
import logger from '../services/logger'
import { assertSafeSegment } from '../services/path-safety'
import { ORDER_PREFIX_RE, isPakFormOfMod, migratePakFilenameStores, stripOrderPrefix, type PakLocations } from './mods-order'
import type { ModStateEntry } from './mods-update-state'
import type { LocalModRef } from './types'

/** One outgoing receipt PAK name and the incoming PAK name that replaced it. */
export interface PakSuccession {
  from: string
  to: string
}

// "1", "12", "v2", "1X", "03B" — a version (or game-build) token.
const VERSION_TOKEN_RE = /^v?\d+[a-z]?$/i

// The pak name with its version-looking tokens dropped, lowercased:
// "Foo_1.1X_v1.2.1" and "Foo_1.1Z_v1.3.0" both reduce to "foo". Splits on
// `_`, `-`, `.` and whitespace; a load-order prefix is ignored.
export function versionStem(name: unknown): string {
  return stripOrderPrefix(String(name ?? '')).toLowerCase()
    .split(/[\s._-]+/)
    .filter(t => t && !VERSION_TOKEN_RE.test(t))
    .join('_')
}

const coreKey = (name: string): string => stripOrderPrefix(name).toLowerCase()

type LocalMods = ReadonlyArray<LocalModRef | null | undefined> | null | undefined

// PURE. Which outgoing PAK entries the incoming version replaced, and by what.
// `outgoing` = the superseded receipt's localMods, `incoming` = what the new
// version landed (both receipt base names: no extension, no `_P`). A pak the
// new version re-landed under its own name is handled by the installer's
// rotation and never paired. The rest pair:
//   - one-to-one when exactly one outgoing pak went missing and exactly one
//     new pak appeared — the common "renamed single-pak mod" case;
//   - otherwise only by an unambiguous version-stem match, so an extra pak
//     that merely shares the receipt (claim-linked via nexus:link-mod) stays.
export function pairRenamedPaks(outgoing: LocalMods, incoming: LocalMods): PakSuccession[] {
  const paks = (list: LocalMods): LocalModRef[] =>
    (Array.isArray(list) ? list : []).filter((lm): lm is LocalModRef => !!lm && lm.modType === 'PAK' && typeof lm.name === 'string' && lm.name !== '')
  const outPaks = paks(outgoing)
  const inPaks = paks(incoming)
  const inKeys = new Set(inPaks.map(lm => coreKey(lm.name)))
  const outKeys = new Set(outPaks.map(lm => coreKey(lm.name)))
  const gone = outPaks.filter(lm => !inKeys.has(coreKey(lm.name)))
  const fresh = inPaks.filter(lm => !outKeys.has(coreKey(lm.name)))
  if (gone.length === 0 || fresh.length === 0) return []
  if (gone.length === 1 && fresh.length === 1) return [{ from: gone[0].name, to: fresh[0].name }]

  const pairs: PakSuccession[] = []
  for (const g of gone) {
    const stem = versionStem(g.name)
    if (!stem) continue
    const matches = fresh.filter(f => versionStem(f.name) === stem)
    // Both sides must be unique: two outgoing paks claiming the same stem
    // (or two incoming ones) is ambiguous — leave them for the user.
    if (matches.length !== 1) continue
    if (gone.filter(o => versionStem(o.name) === stem).length !== 1) continue
    pairs.push({ from: g.name, to: matches[0].name })
  }
  return pairs
}

// Retire each paired outgoing pak: delete every on-disk form (`_P` / plain,
// enabled / `.disabled`, IoStore .ucas/.utoc siblings, load-order prefixed),
// move its filename-keyed stores to the incoming pak's filename, and re-point
// the matching `prevState` entry (captureModState's snapshot, mutated in place)
// so restoreModState re-applies the user's enabled state and load-order prefix
// to the new pak. A pair whose new pak is not on disk is skipped — the old
// version is never removed without its replacement in place. Returns how many
// pairs were retired. Caller holds the shared write mutex.
export function retireRenamedPaks({ paksPaths, ue4ssModsPath }: PakLocations, pairs: readonly PakSuccession[], prevState: ModStateEntry[]): number {
  let retired = 0
  for (const { from, to } of pairs) {
    // Receipt names come from configStore (renderer-writable) — flat segments only.
    try {
      assertSafeSegment('modName', from)
      assertSafeSegment('modName', to)
    } catch { continue }

    const doomed: string[] = []
    let oldFilename: string | null = null
    let newFilename: string | null = null
    for (const dir of paksPaths || []) {
      let names: string[] = []
      try { names = fs.readdirSync(dir) } catch { continue }
      for (const fn of names) {
        if (isPakFormOfMod(fn, from)) {
          doomed.push(path.join(dir, fn))
          if (!oldFilename && /\.pak(\.disabled)?$/i.test(fn)) oldFilename = fn.replace(/\.disabled$/i, '')
        } else if (!newFilename && /\.pak$/i.test(fn) && isPakFormOfMod(fn, to)) {
          newFilename = fn
        }
      }
    }
    if (!oldFilename || !newFilename) continue

    let removed = 0
    for (const p of doomed) {
      try {
        fs.unlinkSync(p)
        removed++
      } catch (err) {
        logger.warn(`renamed-update: could not remove ${path.basename(p)}: ${(err as Error).message}`)
      }
    }
    if (removed === 0) continue

    migratePakFilenameStores(ue4ssModsPath, oldFilename, newFilename)
    const prefix = (from.match(ORDER_PREFIX_RE) || [''])[0]
    for (const entry of prevState) {
      if (entry.modType === 'PAK' && entry.name === from) {
        entry.name = `${prefix}${to}`
        entry.coreName = to
      }
    }
    logger.info(`renamed-update: ${oldFilename} replaced by ${newFilename}`)
    retired++
  }
  return retired
}
