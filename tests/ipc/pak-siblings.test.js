// Regression: a modern UE pak mod is three files sharing one stem —
// Mod_P.pak + Mod_P.ucas + Mod_P.utoc — and the engine pairs them BY FILENAME.
// Archiving, restoring, deleting or renaming only the .pak left a stale index
// beside fresh assets (or the reverse), so the mod silently stopped loading.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  listPakSiblings,
  pakStem,
  removePakVariants,
  archiveModVersion,
  restoreArchivedVersion,
} from '../../src/main/ipc/mod-versions.js'

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-sib-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

const touch = (d, name, body = name) => {
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, name), body)
}

describe('pakStem', () => {
  it('strips the pak extension and any .disabled suffix', () => {
    expect(pakStem('Cool_P.pak')).toBe('Cool_P')
    expect(pakStem('Cool_P.pak.disabled')).toBe('Cool_P')
    expect(pakStem('Cool_P.PAK')).toBe('Cool_P')
  })

  it('leaves a name containing ".disabled" mid-string intact', () => {
    expect(pakStem('No.disabled.Zombies_P.pak')).toBe('No.disabled.Zombies_P')
  })
})

describe('listPakSiblings', () => {
  it('finds the whole file set from any member', () => {
    for (const n of ['Cool_P.pak', 'Cool_P.ucas', 'Cool_P.utoc']) touch(dir, n)
    touch(dir, 'Other_P.pak')
    expect(listPakSiblings(dir, 'Cool_P.pak').sort())
      .toEqual(['Cool_P.pak', 'Cool_P.ucas', 'Cool_P.utoc'])
  })

  it('matches case-insensitively', () => {
    for (const n of ['Cool_P.PAK', 'Cool_P.UCAS']) touch(dir, n)
    expect(listPakSiblings(dir, 'Cool_P.pak').sort()).toEqual(['Cool_P.PAK', 'Cool_P.UCAS'])
  })

  it('includes the disabled pak alongside its plain siblings', () => {
    for (const n of ['Cool_P.pak.disabled', 'Cool_P.ucas', 'Cool_P.utoc']) touch(dir, n)
    expect(listPakSiblings(dir, 'Cool_P.pak.disabled')).toHaveLength(3)
  })

  it('does not match a mod whose stem merely starts the same', () => {
    for (const n of ['Cool_P.pak', 'CoolExtra_P.pak']) touch(dir, n)
    expect(listPakSiblings(dir, 'Cool_P.pak')).toEqual(['Cool_P.pak'])
  })

  it('returns [] for an unreadable directory instead of throwing', () => {
    expect(listPakSiblings(path.join(dir, 'nope'), 'X.pak')).toEqual([])
  })
})

describe('removePakVariants', () => {
  it('removes the siblings too, not just the .pak', () => {
    const paks = path.join(dir, 'Paks')
    for (const n of ['Cool_P.pak', 'Cool_P.ucas', 'Cool_P.utoc']) touch(paks, n)
    touch(paks, 'Keep_P.pak')
    removePakVariants([paks], 'Cool')
    expect(fs.readdirSync(paks)).toEqual(['Keep_P.pak'])
  })
})

describe('archive → restore keeps the set together', () => {
  it('round-trips .pak/.ucas/.utoc', () => {
    const paks = path.join(dir, 'Paks')
    const retention = path.join(dir, 'mod-versions')
    for (const n of ['Cool_P.pak', 'Cool_P.ucas', 'Cool_P.utoc']) touch(paks, n, `v1-${n}`)

    const receipt = { modId: 7, fileId: 1, version: '1.0', localMods: [{ modType: 'PAK', name: 'Cool' }] }
    const snap = archiveModVersion({ paksPaths: [paks], ue4ssModsPath: null }, retention, receipt, 1000)
    expect(snap).toBeTruthy()
    expect(fs.readdirSync(path.join(snap.dir, 'paks')).sort())
      .toEqual(['Cool_P.pak', 'Cool_P.ucas', 'Cool_P.utoc'])

    // A v2 install replaces all three on disk.
    for (const n of ['Cool_P.pak', 'Cool_P.ucas', 'Cool_P.utoc']) touch(paks, n, `v2-${n}`)

    restoreArchivedVersion(
      { paksPaths: [paks], ue4ssModsPath: null, primaryPaksPath: paks },
      snap.dir,
    )
    for (const n of ['Cool_P.pak', 'Cool_P.ucas', 'Cool_P.utoc']) {
      expect(fs.readFileSync(path.join(paks, n), 'utf-8'), n).toBe(`v1-${n}`)
    }
  })

  it('still restores a legacy snapshot that only recorded `filename`', () => {
    const paks = path.join(dir, 'Paks')
    const snapDir = path.join(dir, 'legacy')
    touch(path.join(snapDir, 'paks'), 'Cool_P.pak', 'old')
    fs.writeFileSync(path.join(snapDir, 'manifest.json'), JSON.stringify({
      modId: 7, fileId: 1, modVersion: '1.0',
      entries: [{ kind: 'PAK', filename: 'Cool_P.pak', name: 'Cool' }],
    }))
    fs.mkdirSync(paks, { recursive: true })

    const out = restoreArchivedVersion(
      { paksPaths: [paks], ue4ssModsPath: null, primaryPaksPath: paks },
      snapDir,
    )
    expect(out.localMods).toEqual([{ modType: 'PAK', name: 'Cool' }])
    expect(fs.readFileSync(path.join(paks, 'Cool_P.pak'), 'utf-8')).toBe('old')
  })
})
