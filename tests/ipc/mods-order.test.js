import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  stripOrderPrefix,
  comparePakNames,
  pickWinningName,
  migrateProfiles,
  migrateReceipts,
  migrateCustomNames,
  migrateHybridLinks,
} from '../../src/main/ipc/mods-order.js'

describe('stripOrderPrefix', () => {
  it('strips z<N>_ prefixes of any escalation level', () => {
    expect(stripOrderPrefix('z1_Foo_P.pak')).toBe('Foo_P.pak')
    expect(stripOrderPrefix('zz12_Foo.pak')).toBe('Foo.pak')
    expect(stripOrderPrefix('ZZ3_Foo.pak')).toBe('Foo.pak')
  })

  it('leaves ordinary names alone (zebra has no digit+underscore)', () => {
    expect(stripOrderPrefix('zebra.pak')).toBe('zebra.pak')
    expect(stripOrderPrefix('Foo_P.pak')).toBe('Foo_P.pak')
    expect(stripOrderPrefix('z_Foo.pak')).toBe('z_Foo.pak')
  })
})

describe('comparePakNames', () => {
  it('is case-insensitive lexical', () => {
    expect(comparePakNames('Alpha.pak', 'beta.pak')).toBeLessThan(0)
    expect(comparePakNames('ZEBRA.pak', 'apple.pak')).toBeGreaterThan(0)
    expect(comparePakNames('Same.pak', 'same.pak')).toBe(0)
  })
})

describe('pickWinningName', () => {
  it('returns the name unchanged when it already wins', () => {
    expect(pickWinningName('zzz.pak', ['aaa.pak', 'bbb.pak'])).toBe('zzz.pak')
  })

  it('prefixes z1_ to beat plain rivals', () => {
    expect(pickWinningName('Alpha_P.pak', ['Beta_P.pak'])).toBe('z1_Alpha_P.pak')
  })

  it('escalates to zz when a rival name itself sorts into the z-range', () => {
    expect(pickWinningName('Alpha.pak', ['zebra.pak'])).toBe('zz1_Alpha.pak')
  })

  it('replaces an existing prefix instead of stacking', () => {
    const result = pickWinningName('z1_Alpha.pak', ['z2_Beta.pak'])
    expect(result).toBe('z3_Alpha.pak')
    expect(result.includes('z1_z')).toBe(false)
  })

  it('ignores itself in the competitor list', () => {
    expect(pickWinningName('zzz.pak', ['zzz.pak', 'aaa.pak'])).toBe('zzz.pak')
  })

  it('throws when no prefix within the cap can win', () => {
    expect(() => pickWinningName('a.pak', ['zzzzzz.pak'])).toThrow(/winning/i)
  })
})

describe('store migrations (pure)', () => {
  it('migrateProfiles rewrites exact and .disabled filenames only', () => {
    const profiles = [
      { id: 1, enabledModFilenames: ['Alpha_P.pak', 'Other.pak', 'Alpha_P.pak.disabled'] },
      { id: 2, enabledModFilenames: ['Unrelated.pak'] },
    ]
    const out = migrateProfiles(profiles, 'Alpha_P.pak', 'z1_Alpha_P.pak')
    expect(out[0].enabledModFilenames).toEqual(['z1_Alpha_P.pak', 'Other.pak', 'z1_Alpha_P.pak.disabled'])
    expect(out[1].enabledModFilenames).toEqual(['Unrelated.pak'])
  })

  it('migrateReceipts rewrites PAK localMods by base name, leaves UE4SS alone', () => {
    const receipts = [
      { modId: 1, localMods: [{ modType: 'PAK', name: 'Alpha' }, { modType: 'UE4SS', name: 'Alpha' }] },
      { modId: 2, localMods: [{ modType: 'PAK', name: 'Other' }] },
    ]
    const out = migrateReceipts(receipts, 'Alpha_P.pak', 'z1_Alpha_P.pak')
    expect(out[0].localMods[0]).toEqual({ modType: 'PAK', name: 'z1_Alpha' })
    expect(out[0].localMods[1]).toEqual({ modType: 'UE4SS', name: 'Alpha' })
    expect(out[1].localMods[0]).toEqual({ modType: 'PAK', name: 'Other' })
  })

  it('migrateCustomNames moves the custom name to the new key', () => {
    const names = { 'Alpha_P.pak': '我的最愛', 'Other.pak': 'x' }
    const out = migrateCustomNames(names, 'Alpha_P.pak', 'z1_Alpha_P.pak')
    expect(out['z1_Alpha_P.pak']).toBe('我的最愛')
    expect(out['Alpha_P.pak']).toBeUndefined()
    expect(out['Other.pak']).toBe('x')
  })

  it('migrateCustomNames is a no-op when the key is absent', () => {
    const names = { 'Other.pak': 'x' }
    expect(migrateCustomNames(names, 'Alpha_P.pak', 'z1_Alpha_P.pak')).toBe(names)
  })
})

describe('migrateHybridLinks (fs)', () => {
  let ue4ss
  beforeEach(() => {
    ue4ss = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-order-'))
  })
  afterEach(() => {
    fs.rmSync(ue4ss, { recursive: true, force: true })
  })

  it('rewrites matching pakFiles entries and leaves others untouched', () => {
    const modA = path.join(ue4ss, 'ModA')
    const modB = path.join(ue4ss, 'ModB')
    fs.mkdirSync(modA); fs.mkdirSync(modB)
    fs.writeFileSync(path.join(modA, '_hzmm_link.json'), JSON.stringify({ pakFiles: ['Alpha_P.pak', 'Keep.pak'] }))
    fs.writeFileSync(path.join(modB, '_hzmm_link.json'), JSON.stringify({ pakFiles: ['Unrelated.pak'] }))

    migrateHybridLinks(ue4ss, 'Alpha_P.pak', 'z1_Alpha_P.pak')

    const a = JSON.parse(fs.readFileSync(path.join(modA, '_hzmm_link.json'), 'utf-8'))
    const b = JSON.parse(fs.readFileSync(path.join(modB, '_hzmm_link.json'), 'utf-8'))
    expect(a.pakFiles).toEqual(['z1_Alpha_P.pak', 'Keep.pak'])
    expect(b.pakFiles).toEqual(['Unrelated.pak'])
    expect(fs.existsSync(path.join(modA, '_hzmm_link.json.tmp'))).toBe(false)
  })

  it('matches entries recorded in .disabled form', () => {
    const modA = path.join(ue4ss, 'ModA')
    fs.mkdirSync(modA)
    fs.writeFileSync(path.join(modA, '_hzmm_link.json'), JSON.stringify({ pakFiles: ['Alpha_P.pak.disabled'] }))
    migrateHybridLinks(ue4ss, 'Alpha_P.pak', 'z1_Alpha_P.pak')
    const a = JSON.parse(fs.readFileSync(path.join(modA, '_hzmm_link.json'), 'utf-8'))
    expect(a.pakFiles).toEqual(['z1_Alpha_P.pak'])
  })
})
