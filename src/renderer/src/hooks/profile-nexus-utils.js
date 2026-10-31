import { normalizeFilename } from './profile-utils.js';

// Classify a profile's wanted mods against what's installed locally:
//   missing  — wanted filenames not present on disk
//   auto     — missing mods that have a Nexus source AND the user has a Premium key
//   manual   — missing mods to fetch by hand (no source, or no Premium key)
//              (source object when known, else { filename, displayName })
export function classifyProfileMods(profile, modules, hasPremiumKey) {
  const present = new Set((modules || []).map(m => normalizeFilename(m.filename)));
  const wanted = (Array.isArray(profile?.enabledModFilenames) ? profile.enabledModFilenames : []).map(normalizeFilename).filter(Boolean);
  const sources = Array.isArray(profile?.nexusSources) ? profile.nexusSources.filter(s => s && typeof s === 'object') : [];
  const sourceByFn = new Map(sources.map(s => [normalizeFilename(s.filename), s]));

  const missing = wanted.filter(fn => !present.has(fn));
  const auto = [];
  const manual = [];
  for (const fn of missing) {
    const src = sourceByFn.get(fn);
    if (src && hasPremiumKey) auto.push(src);
    else manual.push(src || { filename: fn, displayName: fn });
  }
  return { missing, auto, manual };
}
