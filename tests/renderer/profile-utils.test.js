import { describe, it, expect } from 'vitest'
import {
  normalizeFilename,
  normalizeProfileFilenames,
  modIsInProfile,
  localISODate,
  sanitizeProfile,
  sanitizeProfiles,
} from '../../src/renderer/src/hooks/profile-utils.js'

describe('normalizeFilename', () => {
  it('strips .disabled suffix from PAK', () => {
    expect(normalizeFilename('mymod.pak.disabled')).toBe('mymod.pak')
  })

  it('is case-insensitive for the suffix', () => {
    expect(normalizeFilename('mymod.pak.DISABLED')).toBe('mymod.pak')
    expect(normalizeFilename('mymod.pak.Disabled')).toBe('mymod.pak')
  })

  it('leaves enabled PAK filenames untouched', () => {
    expect(normalizeFilename('mymod.pak')).toBe('mymod.pak')
  })

  it('leaves UE4SS folder names untouched', () => {
    expect(normalizeFilename('MyUe4ssMod')).toBe('MyUe4ssMod')
    expect(normalizeFilename('folder_with_disabled_in_name')).toBe('folder_with_disabled_in_name')
  })

  it('only strips a trailing .disabled, not one in the middle', () => {
    expect(normalizeFilename('mod.disabled.pak')).toBe('mod.disabled.pak')
  })

  it('handles non-string input safely', () => {
    expect(normalizeFilename(null)).toBe('')
    expect(normalizeFilename(undefined)).toBe('')
    expect(normalizeFilename(42)).toBe('')
  })
})

describe('normalizeProfileFilenames', () => {
  it('returns a Set of normalized filenames', () => {
    const set = normalizeProfileFilenames(['a.pak', 'b.pak.disabled', 'CMod'])
    expect(set.has('a.pak')).toBe(true)
    expect(set.has('b.pak')).toBe(true)
    expect(set.has('CMod')).toBe(true)
    expect(set.size).toBe(3)
  })

  it('deduplicates entries that normalize to the same key', () => {
    const set = normalizeProfileFilenames(['dup.pak', 'dup.pak.disabled'])
    expect(set.size).toBe(1)
    expect(set.has('dup.pak')).toBe(true)
  })

  it('returns empty set for non-array input', () => {
    expect(normalizeProfileFilenames(null).size).toBe(0)
    expect(normalizeProfileFilenames(undefined).size).toBe(0)
    expect(normalizeProfileFilenames('not an array').size).toBe(0)
  })
})

describe('modIsInProfile — the actual bug scenarios', () => {
  it('MATCHES enabled PAK when profile has the same .pak', () => {
    const set = normalizeProfileFilenames(['mymod.pak'])
    const mod = { filename: 'mymod.pak', enabled: true, type: 'PAK' }
    expect(modIsInProfile(set, mod)).toBe(true)
  })

  it('MATCHES currently-disabled PAK when profile has the .pak form — the bug case', () => {
    // This is the regression that prompted the fix:
    // Profile was saved with ['mymod.pak'] (enabled state).
    // User later disabled the PAK — on-disk name is now mymod.pak.disabled.
    // Applying the profile must re-enable this mod.
    const set = normalizeProfileFilenames(['mymod.pak'])
    const mod = { filename: 'mymod.pak.disabled', enabled: false, type: 'PAK' }
    expect(modIsInProfile(set, mod)).toBe(true)
  })

  it('DOES NOT MATCH a PAK not in the profile', () => {
    const set = normalizeProfileFilenames(['mymod.pak'])
    const mod = { filename: 'othermod.pak', enabled: true, type: 'PAK' }
    expect(modIsInProfile(set, mod)).toBe(false)
  })

  it('MATCHES UE4SS mod by folder name', () => {
    const set = normalizeProfileFilenames(['MyUe4ssMod'])
    const mod = { filename: 'MyUe4ssMod', enabled: false, type: 'UE4SS' }
    expect(modIsInProfile(set, mod)).toBe(true)
  })

  it('handles an old profile that accidentally stored a .disabled entry', () => {
    // Defensive — shouldn't happen since handleCreateProfile only stores
    // enabled mods, but normalize-on-read means an import from an older
    // version still works.
    const set = normalizeProfileFilenames(['mymod.pak.disabled'])
    const mod = { filename: 'mymod.pak', enabled: true, type: 'PAK' }
    expect(modIsInProfile(set, mod)).toBe(true)
  })

  it('safely returns false for invalid mod object', () => {
    const set = normalizeProfileFilenames(['mymod.pak'])
    expect(modIsInProfile(set, null)).toBe(false)
    expect(modIsInProfile(set, {})).toBe(false)
    expect(modIsInProfile(set, { filename: null })).toBe(false)
  })

  it('safely returns false for invalid profile set', () => {
    const mod = { filename: 'mymod.pak' }
    expect(modIsInProfile(null, mod)).toBe(false)
  })
})

describe('localISODate', () => {
  it('formats the local calendar date, zero-padded', () => {
    expect(localISODate(new Date(2026, 0, 5, 1, 0))).toBe('2026-01-05')
    expect(localISODate(new Date(2026, 9, 31, 23, 59))).toBe('2026-10-31')
  })
})

describe('sanitizeProfile', () => {
  it('keeps a well-formed profile as-is', () => {
    const p = {
      id: 'p1', name: 'Coop', enabledModFilenames: ['a.pak', 'Lua'],
      nexusSources: [{ filename: 'a.pak', modId: 1, fileId: 11, version: '1.0', displayName: 'A' }],
      configSnapshot: { Lua: { 'config.lua': 'x' } }, createdAt: '2026-10-31',
    }
    expect(sanitizeProfile(p)).toEqual(p)
  })

  it('drops wrong-typed filenames and invalid sources', () => {
    const r = sanitizeProfile({
      name: 'S', enabledModFilenames: ['a.pak', 42, null, ''],
      nexusSources: [null, { filename: 'a.pak', modId: 0 }, { filename: 'b.pak', modId: 2, fileId: 'x', displayName: 7 }],
      configSnapshot: [1],
    })
    expect(r.enabledModFilenames).toEqual(['a.pak'])
    expect(r.nexusSources).toEqual([{ filename: 'b.pak', modId: 2, fileId: null, version: null, displayName: 'b.pak' }])
    expect(r.configSnapshot).toBeNull()
  })

  it('treats a non-array nexusSources as none', () => {
    expect(sanitizeProfile({ name: 'S', enabledModFilenames: [], nexusSources: {} }).nexusSources).toEqual([])
  })

  it('rejects things that are not profiles', () => {
    expect(sanitizeProfile(null)).toBeNull()
    expect(sanitizeProfile([])).toBeNull()
    expect(sanitizeProfile({ name: 'S', enabledModFilenames: 'a.pak' })).toBeNull()
    expect(sanitizeProfile({ name: '', enabledModFilenames: [] })).toBeNull()
    expect(sanitizeProfile({ name: { x: 1 }, enabledModFilenames: [] })).toBeNull()
  })

  it('sanitizeProfiles filters a stored list and tolerates a non-array', () => {
    expect(sanitizeProfiles([null, { name: 'A', enabledModFilenames: [] }]).map(p => p.name)).toEqual(['A'])
    expect(sanitizeProfiles('nope')).toEqual([])
  })

  it('uses fallbackName for a blank or non-text name instead of rejecting', () => {
    const opts = { fallbackName: 'Unnamed' }
    expect(sanitizeProfile({ name: '  ', enabledModFilenames: [] }, opts).name).toBe('Unnamed')
    expect(sanitizeProfile({ name: true, enabledModFilenames: [] }, opts).name).toBe('Unnamed')
    expect(sanitizeProfile({ enabledModFilenames: ['a.pak'] }, opts)).toMatchObject({ name: 'Unnamed', enabledModFilenames: ['a.pak'] })
    // Real names are untouched, and non-profiles are still dropped.
    expect(sanitizeProfile({ name: ' Coop ', enabledModFilenames: [] }, opts).name).toBe(' Coop ')
    expect(sanitizeProfile({ name: 7, enabledModFilenames: [] }, opts).name).toBe('7')
    expect(sanitizeProfile({ name: 'S', enabledModFilenames: 'a.pak' }, opts)).toBeNull()
    expect(sanitizeProfile(null, opts)).toBeNull()
    // A blank fallback gives the strict behaviour.
    expect(sanitizeProfile({ name: '  ', enabledModFilenames: [] }, { fallbackName: ' ' })).toBeNull()
  })

  it('sanitizeProfiles passes fallbackName to every entry (not the map index)', () => {
    const list = [{ name: '', enabledModFilenames: [] }, { name: 'B', enabledModFilenames: [] }, null]
    expect(sanitizeProfiles(list, { fallbackName: 'Unnamed' }).map(p => p.name)).toEqual(['Unnamed', 'B'])
    expect(sanitizeProfiles(list).map(p => p.name)).toEqual(['B'])
  })
})
