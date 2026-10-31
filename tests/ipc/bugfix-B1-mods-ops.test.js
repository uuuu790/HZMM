import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Regression tests for the mods-ops cluster: UE4SS toggle vs registry-enabled
// state, load-order apply rollback, untrusted hybrid link names, README lookup
// after a load-order rename, nexusSources / vanilla-restore migration, partial
// scan caching, install-preview "Reinstall" flag, IoStore siblings on rename /
// remove, and multi-pak hybrids driven from a pak row.

const state = vi.hoisted(() => ({
  handlers: new Map(),
  gamePath: null,
  configDir: null,
  paksPaths: [],
  ue4ssModsPath: null,
  config: {},
  send: null,
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel, fn) => state.handlers.set(channel, fn) },
  app: { getPath: () => os.tmpdir() },
  shell: {},
  net: {},
}))
vi.mock('../../src/main/services/logger', () => ({
  default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))
vi.mock('../../src/main/services/config-store', () => ({
  default: {
    get: (key, def = null) => (key === 'gamePath' ? state.gamePath : (key in state.config ? state.config[key] : def)),
    set: (key, value) => { state.config[key] = value },
    remove: (key) => { delete state.config[key] },
    getConfigDir: () => state.configDir,
  },
}))
vi.mock('../../src/main/services/steam-detector', () => ({
  getAllPaksPaths: () => state.paksPaths,
  getUe4ssModsPath: () => state.ue4ssModsPath,
  getPaksPath: () => state.paksPaths[0],
}))
// The install pipeline and archive readers aren't under test here; stub them so
// this file only exercises the handlers in mods.ts / mods-readme.ts.
vi.mock('../../src/main/ipc/mods-install', () => ({
  installMods: vi.fn(),
  serializeModWrite: (task) => Promise.resolve().then(task),
}))
vi.mock('../../src/main/services/archive', () => ({
  extractZip: vi.fn(),
  extractRar: vi.fn(),
  extract7z: vi.fn(),
  detectArchiveFormat: vi.fn(),
  downloadFile: vi.fn(),
  copyFile: vi.fn(),
}))

import { registerModsIpc } from '../../src/main/ipc/mods'
import { registerModsReadmeIpc } from '../../src/main/ipc/mods-readme'
import { scanMods } from '../../src/main/ipc/mods-scan'
import {
  migrateProfiles,
  migrateVanillaRestore,
  migrateHybridLinks,
  renamePakEverywhere,
} from '../../src/main/ipc/mods-order'

const mainWindow = {
  isDestroyed: () => false,
  webContents: { send: (...args) => state.send(...args) },
}

beforeAll(() => {
  registerModsIpc(mainWindow)
  registerModsReadmeIpc()
})

let root, paksRoot, modsDir, ue4ss, readmesDir

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-b1-mods-ops-'))
  paksRoot = path.join(root, 'HumanitZ', 'Content', 'Paks')
  modsDir = path.join(paksRoot, '~mods')
  ue4ss = path.join(root, 'ue4ss', 'Mods')
  readmesDir = path.join(root, 'config', 'readmes')
  for (const d of [modsDir, ue4ss, readmesDir]) fs.mkdirSync(d, { recursive: true })
  state.gamePath = root
  state.configDir = path.join(root, 'config')
  state.paksPaths = [modsDir, paksRoot]
  state.ue4ssModsPath = ue4ss
  state.config = {}
  state.send = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

const invoke = (channel, ...args) => state.handlers.get(channel)({}, ...args)
const ls = (dir) => fs.readdirSync(dir).sort()
const touch = (dir, name, content = 'x') => fs.writeFileSync(path.join(dir, name), content)

function makeUe4ssMod(name, { enabled = false, link = null } = {}) {
  const dir = path.join(ue4ss, name)
  fs.mkdirSync(path.join(dir, 'Scripts'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'Scripts', 'main.lua'), '')
  if (enabled) fs.writeFileSync(path.join(dir, 'enabled.txt'), '')
  if (link) fs.writeFileSync(path.join(dir, '_hzmm_link.json'), JSON.stringify({ pakFiles: link }))
  return dir
}

const scanned = (id) => scanMods().find(m => m.id === id)

describe('gid 17: UE4SS toggle honors the registry-enabled state the scan reports', () => {
  it('disables a mod enabled only via mods.txt (no enabled.txt) in one click', async () => {
    makeUe4ssMod('RegMod')
    touch(ue4ss, 'mods.txt', 'RegMod : 1\n')
    expect(scanned('ue4ss:RegMod').enabled).toBe(true)

    const result = await invoke('mods:toggle', 'RegMod')

    expect(result.enabled).toBe(false)
    expect(fs.readFileSync(path.join(ue4ss, 'mods.txt'), 'utf-8')).toContain('RegMod : 0')
    expect(fs.existsSync(path.join(ue4ss, 'RegMod', 'enabled.txt'))).toBe(false)
    expect(scanned('ue4ss:RegMod').enabled).toBe(false)
  })

  it('disables a mod enabled only via mods.json', async () => {
    makeUe4ssMod('RegMod')
    touch(ue4ss, 'mods.json', JSON.stringify([{ mod_name: 'RegMod', mod_enabled: true }]))

    const result = await invoke('mods:toggle', 'RegMod')

    expect(result.enabled).toBe(false)
    const json = JSON.parse(fs.readFileSync(path.join(ue4ss, 'mods.json'), 'utf-8'))
    expect(json).toEqual([{ mod_name: 'RegMod', mod_enabled: false }])
    expect(scanned('ue4ss:RegMod').enabled).toBe(false)
  })

  it('still enables a disabled mod', async () => {
    makeUe4ssMod('Off')
    touch(ue4ss, 'mods.txt', 'Off : 0\n')
    const result = await invoke('mods:toggle', 'Off')
    expect(result.enabled).toBe(true)
    expect(fs.existsSync(path.join(ue4ss, 'Off', 'enabled.txt'))).toBe(true)
    expect(fs.readFileSync(path.join(ue4ss, 'mods.txt'), 'utf-8')).toContain('Off : 1')
  })

  it('disabling a hybrid pak also disables its registry-enabled UE4SS half', async () => {
    makeUe4ssMod('Hyb', { link: ['Hyb_P.pak'] })
    touch(ue4ss, 'mods.txt', 'Hyb : 1\n')
    touch(modsDir, 'Hyb_P.pak')

    await invoke('mods:toggle', 'Hyb_P.pak')

    expect(fs.readFileSync(path.join(ue4ss, 'mods.txt'), 'utf-8')).toContain('Hyb : 0')
    expect(scanned('ue4ss:Hyb').enabled).toBe(false)
  })
})

describe('gid 20: apply-pak-order rolls back a half-applied plan', () => {
  it('restores the original names and stores when a rename fails midway, and still notifies', async () => {
    for (const n of ['Alpha_P.pak', 'Bravo_P.pak', 'Charlie_P.pak']) touch(modsDir, n)
    state.config.profiles = [{ id: 'p', name: 'P', enabledModFilenames: ['Alpha_P.pak', 'Bravo_P.pak', 'Charlie_P.pak'] }]
    const realRename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (path.basename(String(from)) === 'Charlie_P.pak') {
        throw Object.assign(new Error('EBUSY: resource busy or locked, rename'), { code: 'EBUSY' })
      }
      return realRename(from, to)
    })

    await expect(invoke('mods:apply-pak-order', ['Charlie_P.pak', 'Bravo_P.pak', 'Alpha_P.pak'])).rejects.toThrow(/EBUSY/)

    expect(ls(modsDir)).toEqual(['Alpha_P.pak', 'Bravo_P.pak', 'Charlie_P.pak'])
    expect(state.config.profiles[0].enabledModFilenames).toEqual(['Alpha_P.pak', 'Bravo_P.pak', 'Charlie_P.pak'])
    expect(state.send).toHaveBeenCalledWith('mods:updated')
  })

  it('make-pak-win notifies the renderer even when the rename fails', async () => {
    touch(modsDir, 'Alpha_P.pak')
    touch(modsDir, 'z1_Alpha_P.pak') // target occupied
    await expect(invoke('mods:make-pak-win', 'Alpha_P.pak', ['Beta_P.pak'])).rejects.toThrow(/already exists/)
    expect(state.send).toHaveBeenCalledWith('mods:updated')
  })
})

describe('gid 22: an untrusted _hzmm_link.json cannot reach base-game paks', () => {
  beforeEach(() => {
    touch(paksRoot, 'pakchunk0-WindowsNoEditor.pak')
    touch(paksRoot, 'global.utoc')
    touch(modsDir, 'Mine_P.pak')
    makeUe4ssMod('Innocent', {
      enabled: true,
      link: ['pakchunk0-WindowsNoEditor.pak', 'global.utoc', 'notes.txt', 'Mine_P.pak'],
    })
    touch(modsDir, 'notes.txt')
  })

  it('toggle leaves base-game files and non-pak files alone but still flips its own pak', async () => {
    await invoke('mods:toggle', 'Innocent')
    expect(ls(paksRoot)).toEqual(['global.utoc', 'pakchunk0-WindowsNoEditor.pak', '~mods'])
    expect(ls(modsDir)).toEqual(['Mine_P.pak.disabled', 'notes.txt'])
  })

  it('remove leaves base-game files and non-pak files alone but still deletes its own pak', async () => {
    await invoke('mods:remove', 'Innocent')
    expect(ls(paksRoot)).toEqual(['global.utoc', 'pakchunk0-WindowsNoEditor.pak', '~mods'])
    expect(ls(modsDir)).toEqual(['notes.txt'])
  })

  it('a pakchunk-named mod pak inside ~mods is still a valid link target', async () => {
    touch(modsDir, 'pakchunk99-Chunky_P.pak')
    makeUe4ssMod('Chunky', { enabled: true, link: ['pakchunk99-Chunky_P.pak'] })
    await invoke('mods:toggle', 'Chunky')
    expect(fs.existsSync(path.join(modsDir, 'pakchunk99-Chunky_P.pak.disabled'))).toBe(true)
  })
})

describe('gids 23/117/140: PAK README survives a load-order rename', () => {
  it('get-readme finds the install-time readme after make-pak-win, and remove cleans it up', async () => {
    touch(modsDir, 'Foo_P.pak')
    touch(readmesDir, 'Foo.txt', '# Foo\nhello')
    expect((await invoke('mods:get-readme', 'Foo_P.pak')).content).toBe('# Foo\nhello')

    const { filename } = await invoke('mods:make-pak-win', 'Foo_P.pak', ['Gamma_P.pak'])
    expect(filename).toBe('z1_Foo_P.pak')

    expect((await invoke('mods:get-readme', 'z1_Foo_P.pak')).content).toBe('# Foo\nhello')
    expect((await invoke('mods:get-readme', 'z1_Foo_P.pak.disabled')).content).toBe('# Foo\nhello')

    await invoke('mods:remove', 'z1_Foo_P.pak')
    expect(fs.existsSync(path.join(readmesDir, 'Foo.txt'))).toBe(false)
  })

  it('works for the 3-digit reorder prefix too', async () => {
    touch(readmesDir, 'Foo.txt', 'hi')
    expect((await invoke('mods:get-readme', '010_Foo_P.pak')).content).toBe('hi')
  })

  it('prefers an exact-name readme over the prefix-stripped one', async () => {
    touch(readmesDir, 'Foo.txt', 'plain')
    touch(readmesDir, 'z1_Foo.txt', 'exact')
    expect((await invoke('mods:get-readme', 'z1_Foo_P.pak')).content).toBe('exact')
  })

  it('remove keeps the shared readme while another form of the mod is still installed', async () => {
    touch(modsDir, 'z1_Foo_P.pak')
    touch(modsDir, 'Foo_P.pak.disabled')
    touch(readmesDir, 'Foo.txt', 'keep')
    await invoke('mods:remove', 'z1_Foo_P.pak')
    expect(fs.existsSync(path.join(readmesDir, 'Foo.txt'))).toBe(true)
  })
})

describe('gid 24: rename migrates nexusSources and the vanilla-restore set', () => {
  it('migrateProfiles rewrites nexusSources[].filename (enabled and .disabled forms)', () => {
    const profiles = [{
      id: 'p',
      name: 'P',
      enabledModFilenames: ['Alpha_P.pak'],
      nexusSources: [
        { filename: 'Alpha_P.pak', modId: 42, fileId: 7 },
        { filename: 'Alpha_P.pak.disabled', modId: 42 },
        { filename: 'Other.pak', modId: 9 },
        null,
      ],
    }]
    const out = migrateProfiles(profiles, 'Alpha_P.pak', 'z1_Alpha_P.pak')
    expect(out[0].enabledModFilenames).toEqual(['z1_Alpha_P.pak'])
    expect(out[0].nexusSources).toEqual([
      { filename: 'z1_Alpha_P.pak', modId: 42, fileId: 7 },
      { filename: 'z1_Alpha_P.pak.disabled', modId: 42 },
      { filename: 'Other.pak', modId: 9 },
      null,
    ])
    expect(out[0].nexusSources[2]).toBe(profiles[0].nexusSources[2])
  })

  it('migrateVanillaRestore rewrites PAK entries only and keeps the reference when nothing matches', () => {
    const pending = { at: 1, entries: [{ type: 'PAK', filename: 'Alpha_P.pak' }, { type: 'UE4SS', filename: 'Alpha_P.pak' }] }
    expect(migrateVanillaRestore(pending, 'Alpha_P.pak', 'z1_Alpha_P.pak')).toEqual({
      at: 1,
      entries: [{ type: 'PAK', filename: 'z1_Alpha_P.pak' }, { type: 'UE4SS', filename: 'Alpha_P.pak' }],
    })
    expect(migrateVanillaRestore(pending, 'Nope.pak', 'z1_Nope.pak')).toBe(pending)
    expect(migrateVanillaRestore(null, 'a', 'b')).toBe(null)
  })

  it('renamePakEverywhere migrates the stored vanilla-restore set', () => {
    touch(modsDir, 'Alpha_P.pak.disabled')
    state.config.vanillaLaunchRestore = { at: 5, entries: [{ type: 'PAK', filename: 'Alpha_P.pak' }] }
    renamePakEverywhere({ paksPaths: [modsDir], ue4ssModsPath: ue4ss }, 'Alpha_P.pak', 'z1_Alpha_P.pak')
    expect(state.config.vanillaLaunchRestore.entries).toEqual([{ type: 'PAK', filename: 'z1_Alpha_P.pak' }])
  })
})

describe('gid 25: a partial scan is not cached', () => {
  it('a later mods:scan picks up paks once the transient readdir failure clears', async () => {
    state.ue4ssModsPath = null
    touch(modsDir, 'Cool_P.pak')
    const realReaddir = fs.readdirSync
    let failed = false
    vi.spyOn(fs, 'readdirSync').mockImplementation((dir, ...rest) => {
      if (!failed && dir === modsDir) {
        failed = true
        throw Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' })
      }
      return realReaddir(dir, ...rest)
    })

    const first = await invoke('mods:scan')
    expect(first.map(m => m.id)).toEqual([])
    const second = await invoke('mods:scan')
    expect(second.map(m => m.id)).toEqual(['Cool_P.pak'])
  })
})

describe('gid 26: install preview flags every pak the install will replace', () => {
  let srcDir
  beforeEach(() => {
    srcDir = path.join(root, 'downloads')
    fs.mkdirSync(srcDir)
  })

  it('matches a load-order-prefixed pak and a lowercase _p pak', async () => {
    touch(modsDir, 'z1_Cool_P.pak')
    touch(modsDir, 'sharp_p.pak')
    for (const n of ['Cool_P.pak', 'sharp_p.pak', 'Fresh_P.pak']) touch(srcDir, n)

    const results = await invoke('mods:preview', ['Cool_P.pak', 'sharp_p.pak', 'Fresh_P.pak'].map(n => path.join(srcDir, n)))

    expect(results.map(r => r.mods[0].existing)).toEqual([true, true, undefined])
  })
})

describe('gid 27: IoStore .ucas/.utoc move and go with their pak', () => {
  it('make-pak-win renames the siblings, and remove deletes them', async () => {
    for (const n of ['Alpha_P.pak', 'Alpha_P.ucas', 'Alpha_P.utoc', 'Beta_P.pak']) touch(modsDir, n)

    await invoke('mods:make-pak-win', 'Alpha_P.pak', ['Beta_P.pak'])
    expect(ls(modsDir)).toEqual(['Beta_P.pak', 'z1_Alpha_P.pak', 'z1_Alpha_P.ucas', 'z1_Alpha_P.utoc'])

    await invoke('mods:remove', 'z1_Alpha_P.pak')
    expect(ls(modsDir)).toEqual(['Beta_P.pak'])
  })

  it('apply-pak-order renumbers the siblings and keeps each one’s .disabled form', async () => {
    for (const n of ['Alpha_P.pak.disabled', 'Alpha_P.ucas', 'Alpha_P.utoc.disabled', 'Bravo_P.pak']) touch(modsDir, n)

    const res = await invoke('mods:apply-pak-order', ['Bravo_P.pak', 'Alpha_P.pak.disabled'])

    expect(res.changed).toBe(true)
    expect(ls(modsDir)).toEqual(['010_Bravo_P.pak', '020_Alpha_P.pak.disabled', '020_Alpha_P.ucas', '020_Alpha_P.utoc.disabled'])
  })

  it('remove deletes .disabled siblings of a disabled pak', async () => {
    for (const n of ['Alpha_P.pak.disabled', 'Alpha_P.ucas.disabled', 'Alpha_P.utoc', 'Other_P.ucas']) touch(modsDir, n)
    await invoke('mods:remove', 'Alpha_P.pak.disabled')
    expect(ls(modsDir)).toEqual(['Other_P.ucas'])
  })

  it('refuses before moving anything when a sibling target is taken', () => {
    for (const n of ['Alpha_P.pak', 'Alpha_P.ucas', 'z1_Alpha_P.ucas']) touch(modsDir, n)
    expect(() => renamePakEverywhere({ paksPaths: [modsDir] }, 'Alpha_P.pak', 'z1_Alpha_P.pak')).toThrow(/z1_Alpha_P\.ucas/)
    expect(ls(modsDir)).toEqual(['Alpha_P.pak', 'Alpha_P.ucas', 'z1_Alpha_P.ucas'])
  })

  it('puts the pak and earlier siblings back when a sibling rename fails', () => {
    for (const n of ['Alpha_P.pak', 'Alpha_P.ucas', 'Alpha_P.utoc']) touch(modsDir, n)
    const realRename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from).endsWith('Alpha_P.utoc')) throw new Error('EBUSY')
      return realRename(from, to)
    })
    expect(() => renamePakEverywhere({ paksPaths: [modsDir] }, 'Alpha_P.pak', 'z1_Alpha_P.pak')).toThrow(/EBUSY/)
    expect(ls(modsDir)).toEqual(['Alpha_P.pak', 'Alpha_P.ucas', 'Alpha_P.utoc'])
  })

  it('migrateHybridLinks rewrites the sibling entries too', () => {
    const dir = makeUe4ssMod('Hyb', { link: ['Alpha_P.pak', 'Alpha_P.ucas', 'Alpha_P.utoc.disabled', 'Alpha.ucas'] })
    migrateHybridLinks(ue4ss, 'Alpha_P.pak', 'z1_Alpha_P.pak')
    const link = JSON.parse(fs.readFileSync(path.join(dir, '_hzmm_link.json'), 'utf-8'))
    expect(link.pakFiles).toEqual(['z1_Alpha_P.pak', 'z1_Alpha_P.ucas', 'z1_Alpha_P.utoc', 'Alpha.ucas'])
  })
})

describe('gid 29: a pak row of a multi-pak hybrid drives all of its paks', () => {
  beforeEach(() => {
    makeUe4ssMod('Hyb', { enabled: true, link: ['HybA_P.pak', 'HybB_P.pak'] })
    touch(modsDir, 'HybA_P.pak')
    touch(modsDir, 'HybB_P.pak')
  })

  it('toggling one pak toggles the sibling pak and the UE4SS folder, both ways', async () => {
    await invoke('mods:toggle', 'HybA_P.pak')
    expect(ls(modsDir)).toEqual(['HybA_P.pak.disabled', 'HybB_P.pak.disabled'])
    expect(fs.existsSync(path.join(ue4ss, 'Hyb', 'enabled.txt'))).toBe(false)

    await invoke('mods:toggle', 'HybA_P.pak.disabled')
    expect(ls(modsDir)).toEqual(['HybA_P.pak', 'HybB_P.pak'])
    expect(fs.existsSync(path.join(ue4ss, 'Hyb', 'enabled.txt'))).toBe(true)
  })

  it('removing one pak removes the sibling pak and the UE4SS folder', async () => {
    await invoke('mods:remove', 'HybA_P.pak')
    expect(ls(modsDir)).toEqual([])
    expect(fs.existsSync(path.join(ue4ss, 'Hyb'))).toBe(false)
  })
})

describe('uppercase .PAK (integration follow-up to gid 8)', () => {
  it('is listed, toggled and removed like a .pak', async () => {
    touch(modsDir, 'Loud_P.PAK', 'PAK')
    expect(scanned('Loud_P.PAK')).toMatchObject({ type: 'PAK', enabled: true, title: 'Loud' })

    await invoke('mods:toggle', 'Loud_P.PAK')
    expect(ls(modsDir)).toEqual(['Loud_P.PAK.disabled'])
    expect(scanned('Loud_P.PAK')).toMatchObject({ enabled: false })

    await invoke('mods:toggle', 'Loud_P.PAK.disabled')
    expect(ls(modsDir)).toEqual(['Loud_P.PAK'])

    await invoke('mods:remove', 'Loud_P.PAK')
    expect(ls(modsDir)).toEqual([])
  })
})
