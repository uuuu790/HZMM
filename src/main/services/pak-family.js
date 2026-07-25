// IoStore ("chunked") mods ship as a .pak/.ucas/.utoc triple whose basenames
// MUST stay identical — Unreal locates the .ucas/.utoc container by the .pak's
// name. Any operation that renames, moves or deletes one member has to carry
// its siblings along, or the mod silently breaks:
//
//   - install/update: rotating only the old .pak aside leaves the stale
//     .ucas/.utoc in place, so the incoming ones get a " (2)" collision suffix
//     and no longer match their .pak.
//   - toggle: renaming only the .pak to .pak.disabled leaves the containers
//     live.
//   - remove: unlinking only the .pak orphans the containers forever (nothing
//     scans for them, so they never surface in the UI again).
//
// Pure string helpers, no fs access — kept in its own module so the rules are
// unit-testable without Electron.

export const PAK_FAMILY_EXTS = ['.pak', '.ucas', '.utoc']

const DISABLED_SUFFIX = '.disabled'

// "Foo_P.pak.disabled" -> { base: 'Foo_P', ext: '.pak', disabled: true }
// Returns null when `filename` is not a pak-family member.
export function parsePakFilename(filename) {
  if (typeof filename !== 'string' || !filename) return null
  let name = filename
  let disabled = false
  if (name.toLowerCase().endsWith(DISABLED_SUFFIX)) {
    disabled = true
    name = name.slice(0, -DISABLED_SUFFIX.length)
  }
  const lower = name.toLowerCase()
  const ext = PAK_FAMILY_EXTS.find((e) => lower.endsWith(e))
  if (!ext) return null
  const base = name.slice(0, -ext.length)
  if (!base) return null
  return { base, ext, disabled }
}

// Every pak-family filename for `base` ("Foo_P") in the requested state.
export function pakFamilyNames(base, { disabled = false } = {}) {
  const suffix = disabled ? DISABLED_SUFFIX : ''
  return PAK_FAMILY_EXTS.map((ext) => `${base}${ext}${suffix}`)
}

// Every filename a mod called `modName` could occupy on disk. Mods are stored
// as either "<name>_P.<ext>" (UE's mod-priority convention) or "<name>.<ext>",
// each optionally disabled. Used to sweep up an existing install before
// overwriting it.
export function pakFamilyCandidates(modName) {
  if (typeof modName !== 'string' || !modName) return []
  const out = []
  for (const base of [`${modName}_P`, modName]) {
    out.push(...pakFamilyNames(base, { disabled: false }))
    out.push(...pakFamilyNames(base, { disabled: true }))
  }
  return out
}

// Given one member's filename, return { from, to } rename pairs for the whole
// family when flipping to `enable`. Only the members that need to move are
// listed; callers skip pairs whose `from` does not exist on disk.
export function pakFamilyToggleRenames(filename, enable) {
  const parsed = parsePakFilename(filename)
  if (!parsed) return []
  return PAK_FAMILY_EXTS.map((ext) => ({
    from: `${parsed.base}${ext}${enable ? DISABLED_SUFFIX : ''}`,
    to: `${parsed.base}${ext}${enable ? '' : DISABLED_SUFFIX}`,
  }))
}
