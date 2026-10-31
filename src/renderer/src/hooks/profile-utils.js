// Pure helpers for profile filename matching.
//
// Background: PAK mods change their on-disk filename when toggled —
// `mymod.pak` (enabled) vs `mymod.pak.disabled` (disabled). A profile
// saves `enabledModFilenames` from the currently enabled state, so it
// always stores the base `.pak` form. When applying a profile against
// mods that are currently disabled, raw string comparison against
// `mod.filename` misses them and the PAK never gets re-enabled.
//
// UE4SS mods are unaffected — their filename is the folder name, which
// does not change between states — but it's still safe to normalize.

export function normalizeFilename(filename) {
  if (typeof filename !== 'string') return ''
  return filename.replace(/\.disabled$/i, '')
}

// Build a fast lookup set of normalized profile filenames.
export function normalizeProfileFilenames(enabledModFilenames) {
  if (!Array.isArray(enabledModFilenames)) return new Set()
  return new Set(enabledModFilenames.map(normalizeFilename).filter(Boolean))
}

// Does `mod` belong in the enabled set described by `profileSet`?
// `profileSet` should come from normalizeProfileFilenames().
export function modIsInProfile(profileSet, mod) {
  if (!profileSet || !mod || typeof mod.filename !== 'string') return false
  return profileSet.has(normalizeFilename(mod.filename))
}

// Local calendar date as YYYY-MM-DD. toISOString() gives the UTC date, which
// is a day behind for UTC+ users (e.g. Taipei) between local 00:00 and 08:00.
export function localISODate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const isPositiveInt = (v) => Number.isInteger(v) && v > 0
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

function sanitizeSource(s) {
  if (!isPlainObject(s) || typeof s.filename !== 'string' || !s.filename || !isPositiveInt(s.modId)) return null
  return {
    ...s,
    fileId: isPositiveInt(s.fileId) ? s.fileId : null,
    version: typeof s.version === 'string' ? s.version : null,
    displayName: typeof s.displayName === 'string' && s.displayName ? s.displayName : s.filename,
  }
}

// Coerce a stored or imported profile into the shape the Profiles tab and the
// apply path rely on (string name, string filenames, array of valid sources),
// so a hand-edited JSON can't crash rendering. Returns null when `p` is not a
// profile at all.
//
// A blank or non-text name (e.g. '  ' or true) rejects the profile unless
// `fallbackName` is given, in which case that name is used instead. Import
// passes none (strict); the stored list passes one, because older versions
// accepted any truthy name on import and dropping those profiles here would
// delete them from config.json on the next write.
export function sanitizeProfile(p, { fallbackName } = {}) {
  if (!isPlainObject(p) || !Array.isArray(p.enabledModFilenames)) return null
  let name = typeof p.name === 'string' ? p.name : (typeof p.name === 'number' ? String(p.name) : '')
  if (!name.trim()) {
    if (typeof fallbackName !== 'string' || !fallbackName.trim()) return null
    name = fallbackName
  }
  return {
    ...p,
    name,
    enabledModFilenames: p.enabledModFilenames.filter(f => typeof f === 'string' && f),
    nexusSources: Array.isArray(p.nexusSources) ? p.nexusSources.map(sanitizeSource).filter(Boolean) : [],
    configSnapshot: isPlainObject(p.configSnapshot) ? p.configSnapshot : null,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : '',
  }
}

// For the stored list: pass { fallbackName } so unnamed profiles are kept.
export function sanitizeProfiles(list, opts) {
  return Array.isArray(list) ? list.map(p => sanitizeProfile(p, opts)).filter(Boolean) : []
}
