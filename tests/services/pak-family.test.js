import { describe, it, expect } from 'vitest'
import {
  PAK_FAMILY_EXTS,
  parsePakFilename,
  pakFamilyNames,
  pakFamilyCandidates,
  pakFamilyToggleRenames,
} from '../../src/main/services/pak-family.js'

describe('parsePakFilename', () => {
  it('splits an enabled pak', () => {
    expect(parsePakFilename('TestMod_P.pak')).toEqual({ base: 'TestMod_P', ext: '.pak', disabled: false })
  })

  it('splits a disabled pak', () => {
    expect(parsePakFilename('TestMod_P.pak.disabled')).toEqual({ base: 'TestMod_P', ext: '.pak', disabled: true })
  })

  it('recognises the IoStore container extensions', () => {
    expect(parsePakFilename('TestMod_P.ucas').ext).toBe('.ucas')
    expect(parsePakFilename('TestMod_P.utoc').ext).toBe('.utoc')
  })

  it('is case-insensitive on the extension', () => {
    expect(parsePakFilename('TestMod_P.PAK')).toEqual({ base: 'TestMod_P', ext: '.pak', disabled: false })
    expect(parsePakFilename('TestMod_P.Pak.DISABLED')).toEqual({ base: 'TestMod_P', ext: '.pak', disabled: true })
  })

  it('returns null for non-family files and junk input', () => {
    expect(parsePakFilename('readme.txt')).toBeNull()
    expect(parsePakFilename('')).toBeNull()
    expect(parsePakFilename(null)).toBeNull()
    expect(parsePakFilename(undefined)).toBeNull()
    expect(parsePakFilename(42)).toBeNull()
    // Bare extension with no basename is not a mod file.
    expect(parsePakFilename('.pak')).toBeNull()
  })
})

describe('pakFamilyNames', () => {
  it('covers every family extension', () => {
    expect(pakFamilyNames('Foo_P')).toEqual(['Foo_P.pak', 'Foo_P.ucas', 'Foo_P.utoc'])
    expect(PAK_FAMILY_EXTS).toEqual(['.pak', '.ucas', '.utoc'])
  })

  it('appends the disabled suffix when asked', () => {
    expect(pakFamilyNames('Foo_P', { disabled: true })).toEqual([
      'Foo_P.pak.disabled',
      'Foo_P.ucas.disabled',
      'Foo_P.utoc.disabled',
    ])
  })
})

describe('pakFamilyCandidates', () => {
  it('covers _P and bare naming, enabled and disabled', () => {
    const out = pakFamilyCandidates('Foo')
    // 2 naming conventions x 3 extensions x 2 states
    expect(out).toHaveLength(12)
    expect(out).toContain('Foo_P.pak')
    expect(out).toContain('Foo_P.ucas')
    expect(out).toContain('Foo_P.utoc')
    expect(out).toContain('Foo.pak')
    expect(out).toContain('Foo.ucas.disabled')
    expect(out).toContain('Foo_P.utoc.disabled')
  })

  it('returns nothing for junk input', () => {
    expect(pakFamilyCandidates('')).toEqual([])
    expect(pakFamilyCandidates(null)).toEqual([])
  })

  // Data-loss regression: rotating only the .pak left the stale .ucas/.utoc in
  // place, so the incoming containers collided into "Foo (2).ucas" and no
  // longer matched their .pak — silently breaking every IoStore mod update.
  it('includes the IoStore containers, not just the .pak', () => {
    const out = pakFamilyCandidates('Foo')
    expect(out.filter((n) => n.includes('.ucas')).length).toBeGreaterThan(0)
    expect(out.filter((n) => n.includes('.utoc')).length).toBeGreaterThan(0)
  })
})

describe('pakFamilyToggleRenames', () => {
  it('disables the whole family together', () => {
    expect(pakFamilyToggleRenames('Foo_P.pak', false)).toEqual([
      { from: 'Foo_P.pak', to: 'Foo_P.pak.disabled' },
      { from: 'Foo_P.ucas', to: 'Foo_P.ucas.disabled' },
      { from: 'Foo_P.utoc', to: 'Foo_P.utoc.disabled' },
    ])
  })

  it('enables the whole family together', () => {
    expect(pakFamilyToggleRenames('Foo_P.pak.disabled', true)).toEqual([
      { from: 'Foo_P.pak.disabled', to: 'Foo_P.pak' },
      { from: 'Foo_P.ucas.disabled', to: 'Foo_P.ucas' },
      { from: 'Foo_P.utoc.disabled', to: 'Foo_P.utoc' },
    ])
  })

  it('always lists the triggering file as one of the pairs, so callers can track the new name', () => {
    for (const [filename, enable] of [['Foo_P.pak', false], ['Foo_P.pak.disabled', true]]) {
      const pairs = pakFamilyToggleRenames(filename, enable)
      expect(pairs.some((p) => p.from === filename)).toBe(true)
    }
  })

  it('returns nothing for a non-family file', () => {
    expect(pakFamilyToggleRenames('notes.txt', false)).toEqual([])
  })
})
