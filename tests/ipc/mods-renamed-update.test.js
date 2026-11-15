import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// In-memory configStore (profiles / receipts / custom names live there) and a
// silent logger, so nothing touches the real %APPDATA%\hzmm-manager.
const store = vi.hoisted(() => ({ data: new Map() }))
vi.mock('../../src/main/services/config-store', () => ({
  default: {
    get: (key, fallback = null) => (store.data.has(key) ? store.data.get(key) : fallback),
    set: (key, value) => { store.data.set(key, value) },
    remove: (key) => { store.data.delete(key) },
    getConfigDir: () => os.tmpdir(),
  },
}))
vi.mock('../../src/main/services/logger', () => ({
  default: { info: () => {}, warn: () => {}, error: () => {}, getPath: () => '', readRecent: () => [] },
}))

import { versionStem, pairRenamedPaks, retireRenamedPaks } from '../../src/main/ipc/mods-renamed-update'
import { restoreModState } from '../../src/main/ipc/mods-update-state'

const pak = (name) => ({ modType: 'PAK', name })

describe('versionStem', () => {
  it('drops version and game-build tokens', () => {
    expect(versionStem('bailing_4TierVehicleCamera_1.1X_v1.2.1')).toBe('bailing_4tiervehiclecamera')
    expect(versionStem('bailing_4TierVehicleCamera_1.1Z_v1.3.0')).toBe('bailing_4tiervehiclecamera')
    expect(versionStem('Bailing_CharacterCamera_1.1X_V1.1.3')).toBe('bailing_charactercamera')
  })

  it('ignores a load-order prefix and keeps plain names intact', () => {
    expect(versionStem('z1_Foo_v2')).toBe('foo')
    expect(versionStem('BetterTrade')).toBe('bettertrade')
  })
})

describe('pairRenamedPaks', () => {
  it('pairs a renamed single-pak mod one-to-one', () => {
    expect(pairRenamedPaks(
      [pak('bailing_4TierVehicleCamera_1.1X_v1.2.1')],
      [pak('bailing_4TierVehicleCamera_1.1Z_v1.3.0')],
    )).toEqual([{ from: 'bailing_4TierVehicleCamera_1.1X_v1.2.1', to: 'bailing_4TierVehicleCamera_1.1Z_v1.3.0' }])
  })

  it('leaves a re-landed same-name pak to the installer rotation', () => {
    expect(pairRenamedPaks([pak('Cool')], [pak('Cool')])).toEqual([])
    // the receipt may carry a load-order prefix the fresh install doesn't
    expect(pairRenamedPaks([pak('z1_Cool')], [pak('Cool')])).toEqual([])
  })

  it('keeps an extra pak that only shares the receipt (claim-linked)', () => {
    expect(pairRenamedPaks(
      [pak('Foo_1.0'), pak('FooAddon')],
      [pak('Foo_1.1')],
    )).toEqual([{ from: 'Foo_1.0', to: 'Foo_1.1' }])
  })

  it('pairs nothing when several renames cannot be told apart', () => {
    expect(pairRenamedPaks([pak('Alpha_v1'), pak('Beta_v1')], [pak('Gamma_v2'), pak('Delta_v2')])).toEqual([])
  })

  it('ignores UE4SS folders and empty inputs', () => {
    expect(pairRenamedPaks([{ modType: 'UE4SS', name: 'LuaA' }], [{ modType: 'UE4SS', name: 'LuaB' }])).toEqual([])
    expect(pairRenamedPaks(null, [pak('X')])).toEqual([])
    expect(pairRenamedPaks([pak('X')], undefined)).toEqual([])
  })
})

describe('retireRenamedPaks', () => {
  let root
  let paks
  let ue4ss

  beforeEach(() => {
    store.data.clear()
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-renamed-'))
    paks = path.join(root, 'Paks', '~mods')
    ue4ss = path.join(root, 'Mods')
    fs.mkdirSync(paks, { recursive: true })
    fs.mkdirSync(ue4ss, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const touch = (name) => fs.writeFileSync(path.join(paks, name), 'x')
  const onDisk = () => fs.readdirSync(paks).sort()

  it('removes every form of the old pak and carries profiles, custom name, receipt and disabled state to the new one', () => {
    const OLD = 'bailing_4TierVehicleCamera_1.1X_v1.2.1'
    const NEW = 'bailing_4TierVehicleCamera_1.1Z_v1.3.0'
    touch(`${OLD}_P.pak.disabled`)
    touch(`${OLD}_P.ucas`)
    touch(`${OLD}_P.utoc`)
    touch(`${NEW}_P.pak`)
    touch('Other_P.pak')
    store.data.set('profiles', [{ name: 'Main', enabledModFilenames: [`${OLD}_P.pak`, 'Other_P.pak'] }])
    store.data.set('modCustomNames', { [`${OLD}_P.pak`]: 'Vehicle cam' })
    store.data.set('nexusInstalledMods', [
      { modId: 143, fileId: 545, installedAt: 1, localMods: [pak(OLD)] },
      { modId: 143, fileId: 569, installedAt: 2, localMods: [pak(NEW)] },
    ])
    const prevState = [{ modType: 'PAK', name: OLD, coreName: OLD, enabled: false }]

    const retired = retireRenamedPaks({ paksPaths: [paks], ue4ssModsPath: ue4ss }, [{ from: OLD, to: NEW }], prevState)

    expect(retired).toBe(1)
    expect(onDisk()).toEqual(['Other_P.pak', `${NEW}_P.pak`].sort())
    expect(store.data.get('profiles')[0].enabledModFilenames).toEqual([`${NEW}_P.pak`, 'Other_P.pak'])
    expect(store.data.get('modCustomNames')).toEqual({ [`${NEW}_P.pak`]: 'Vehicle cam' })
    expect(store.data.get('nexusInstalledMods')[0].localMods).toEqual([pak(NEW)])
    expect(prevState[0]).toMatchObject({ name: NEW, coreName: NEW })

    // ...so the post-update restore re-applies the user's "disabled" choice.
    restoreModState({ paksPaths: [paks], ue4ssModsPath: ue4ss }, prevState)
    expect(onDisk()).toEqual(['Other_P.pak', `${NEW}_P.pak.disabled`].sort())
  })

  it('keeps a load-order prefix for the restore step to re-apply', () => {
    touch('z1_Foo_1.0_P.pak')
    touch('Foo_1.1_P.pak')
    const prevState = [{ modType: 'PAK', name: 'z1_Foo_1.0', coreName: 'Foo_1.0', enabled: true }]

    expect(retireRenamedPaks({ paksPaths: [paks] }, [{ from: 'z1_Foo_1.0', to: 'Foo_1.1' }], prevState)).toBe(1)
    expect(onDisk()).toEqual(['Foo_1.1_P.pak'])
    expect(prevState[0]).toMatchObject({ name: 'z1_Foo_1.1', coreName: 'Foo_1.1' })
  })

  it('never removes the old pak when the new one is not on disk', () => {
    touch('Foo_1.0_P.pak')
    const prevState = [{ modType: 'PAK', name: 'Foo_1.0', coreName: 'Foo_1.0', enabled: true }]

    expect(retireRenamedPaks({ paksPaths: [paks] }, [{ from: 'Foo_1.0', to: 'Foo_1.1' }], prevState)).toBe(0)
    expect(onDisk()).toEqual(['Foo_1.0_P.pak'])
    expect(prevState[0].name).toBe('Foo_1.0')
  })

  it('skips names that are not a flat path segment', () => {
    touch('Foo_1.1_P.pak')
    expect(retireRenamedPaks({ paksPaths: [paks] }, [{ from: '../Foo_1.0', to: 'Foo_1.1' }], [])).toBe(0)
    expect(onDisk()).toEqual(['Foo_1.1_P.pak'])
  })
})
