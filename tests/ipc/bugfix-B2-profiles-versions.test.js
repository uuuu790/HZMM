import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveModConfigPath, isSnapshotConfigFile } from '../../src/main/ipc/mods-config'
import { registerModsProfilesIpc } from '../../src/main/ipc/mods-profiles'
import {
  archiveModVersion,
  listModVersions,
  restoreArchivedVersion,
  removePakVariants,
} from '../../src/main/ipc/mod-versions'

// Regression tests for cluster B2 (profile config snapshot/restore and mod
// version rollback). The profile handlers run for real: electron's ipcMain is
// mocked to capture them and the game/mods paths point at a temp dir.

const state = vi.hoisted(() => ({ handlers: new Map(), gamePath: null, modsPath: null }))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel, fn) => state.handlers.set(channel, fn) },
  shell: {},
}))
vi.mock('../../src/main/services/config-store', () => ({
  default: { get: (key) => (key === 'gamePath' ? state.gamePath : undefined), getConfigDir: () => state.gamePath },
}))
vi.mock('../../src/main/services/steam-detector', () => ({
  getUe4ssModsPath: () => state.modsPath,
}))
vi.mock('../../src/main/ipc/mods-scan', () => ({ invalidateCache: () => {} }))

let root

beforeAll(() => {
  registerModsProfilesIpc()
})
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-b2-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

function write(full, content) {
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}
const read = (full) => fs.readFileSync(full, 'utf-8')

describe('profiles:restore-configs only writes what a snapshot would hold (gid 15)', () => {
  let mods
  const CONFIG_V1 = 'local Config = {\n  A = 1,\n}\nreturn Config\n'
  const CONFIG_V2 = 'local Config = {\n  A = 2,\n}\nreturn Config\n'

  beforeEach(() => {
    state.gamePath = root
    mods = path.join(root, 'Mods')
    state.modsPath = mods
    write(path.join(mods, 'BPModLoaderMod', 'Scripts', 'main.lua'), 'ORIGINAL')
    write(path.join(mods, 'BPModLoaderMod', 'Scripts', 'config.lua'), 'return {}\n')
    write(path.join(mods, 'keybinds', 'config.ini'), 'ORIGINAL')
    write(path.join(mods, 'CoolMod', 'Scripts', 'main.lua'), 'MAIN')
    write(path.join(mods, 'CoolMod', 'Scripts', 'config.lua'), CONFIG_V1)
  })

  const restore = (snapshot) => state.handlers.get('profiles:restore-configs')({}, snapshot)

  it('skips builtin mods, mod code, HZMM state files, the mod folder itself and malformed values', () => {
    const result = restore({
      BPModLoaderMod: { 'Scripts/main.lua': 'os.execute("calc")', 'Scripts/config.lua': 'return { X = 1 }\n' },
      Keybinds: { 'config.ini': 'PLANTED' }, // builtin, matched case-insensitively
      Other: null,
      Listy: ['x'],
      CoolMod: {
        'enabled.txt': '',
        '_hzmm_link.json': '{"pakFiles":["evil.pak"]}',
        'Scripts/main.lua': 'os.execute("calc")',
        'Scripts/evil.lua': 'x',
        '.': 'x',
        'Scripts/..': 'x',
        'Scripts/config.lua:evil.lua': 'x',
        'Scripts/config.ini': 42,
        'Scripts/config.lua': CONFIG_V2,
      },
    })
    expect(result).toBe(true)
    expect(read(path.join(mods, 'BPModLoaderMod', 'Scripts', 'main.lua'))).toBe('ORIGINAL')
    expect(read(path.join(mods, 'BPModLoaderMod', 'Scripts', 'config.lua'))).toBe('return {}\n')
    expect(read(path.join(mods, 'keybinds', 'config.ini'))).toBe('ORIGINAL')
    expect(read(path.join(mods, 'CoolMod', 'Scripts', 'main.lua'))).toBe('MAIN')
    expect(fs.existsSync(path.join(mods, 'CoolMod', 'enabled.txt'))).toBe(false)
    expect(fs.existsSync(path.join(mods, 'CoolMod', '_hzmm_link.json'))).toBe(false)
    expect(fs.existsSync(path.join(mods, 'CoolMod', 'Scripts', 'evil.lua'))).toBe(false)
    expect(fs.existsSync(path.join(mods, 'CoolMod', 'Scripts', 'config.ini'))).toBe(false)
    expect(fs.readdirSync(mods).sort()).toEqual(['BPModLoaderMod', 'CoolMod', 'keybinds'])
    expect(fs.readdirSync(path.join(mods, 'CoolMod', 'Scripts')).sort()).toEqual(['config.lua', 'main.lua'])
    // The legitimate entry still lands.
    expect(read(path.join(mods, 'CoolMod', 'Scripts', 'config.lua'))).toBe(CONFIG_V2)
  })

  it('refuses a config.lua that brings in code, but restores value-only changes', () => {
    const attacks = [
      'local Config = {\n  A = 2,\n}\nos.execute("calc")\nreturn Config\n',
      'local Config = {\n  A = 2,\n}\nprint = os.execute\nreturn Config\n',
      'package.path = "\\\\\\\\evil\\\\share\\\\?.lua"\nlocal Config = {\n  A = 2,\n}\nreturn Config\n',
      'local Config = {\n  A = 2,\n  OnLoad = function() os.execute("calc") end,\n}\nreturn Config\n',
      'local Config = setmetatable({}, { __index = os })\nreturn Config\n',
      'local x <close> = Config\nreturn {}\n',
    ]
    for (const text of attacks) {
      restore({ CoolMod: { 'Scripts/config.lua': text } })
      expect(read(path.join(mods, 'CoolMod', 'Scripts', 'config.lua'))).toBe(CONFIG_V1)
    }
  })

  const CFG = () => path.join(mods, 'CoolMod', 'Scripts', 'config.lua')
  // Restores `text` over `installed` (null: no config.lua yet); true when it was written.
  function restoredOver(installed, text) {
    if (installed === null) fs.rmSync(CFG(), { force: true })
    else write(CFG(), installed)
    restore({ CoolMod: { 'Scripts/config.lua': text } })
    return fs.existsSync(CFG()) && read(CFG()) === text
  }

  it('refuses code hidden in a [key] anywhere along an assignment target', () => {
    const attacks = [
      'local Config = { a = {} }\nConfig[os.execute("calc") and "a"].x = 1\nreturn Config\n',
      'local Config = { a = {} }\nConfig[os.execute("calc")][1] = 1\nreturn Config\n',
      'local Config = { a = { b = {} } }\nConfig.a[io.open("C:/x", "w") and "b"].c = 1\nreturn Config\n',
      'local Config = { a = {} }\nConfig[{ os.execute("calc") }] = 1\nreturn Config\n',
    ]
    for (const text of attacks) {
      expect(restoredOver(CONFIG_V1, text)).toBe(false)
      expect(read(CFG())).toBe(CONFIG_V1)
      expect(restoredOver(null, text)).toBe(false)
    }
  })

  it('compares code by syntax, so a comment can\'t be turned into live code', () => {
    const installed = 'local Config = {\n  OnLoad = function() print("hi") -- os.execute("calc")\n  end,\n}\nreturn Config\n'
    expect(restoredOver(installed, installed.replace('-- os.execute', '--\nos.execute'))).toBe(false)
    // Layout and comments alone don't matter.
    expect(restoredOver(installed, installed.replace('print("hi") --', 'print( "hi" )\n  --'))).toBe(true)
  })

  it('refuses installed code moved to another place or bound to another name', () => {
    const installed = 'local Config = {\n  OnSave = function() print("saved") end,\n  OnReset = function() DeleteAllSaves() end,\n  Run = os.execute,\n}\nreturn Config\n'
    const attacks = [
      installed.replace('OnSave = function() print("saved") end', 'OnSave = function() DeleteAllSaves() end'),
      'local print = os.execute\n' + installed,
      installed.replace('return Config', 'Config.OnSave = Config.OnReset\nreturn Config'),
    ]
    for (const text of attacks) expect(restoredOver(installed, text)).toBe(false)
  })

  it('does not trust names after code ran: a call\'s result is no table of this file', () => {
    const installed = 'local Config = {}\nConfig.Holder = GetHolder()\nConfig.Speed = 5\nreturn Config\n'
    expect(restoredOver(installed, installed.replace('Config.Speed = 5', 'Config.Holder.path = "x"'))).toBe(false)
    // Only a function definition in between: values after it still restore.
    const helper = 'local Config = {}\nlocal function clamp(v) return math.min(v, 10) end\nConfig.Speed = 5\nreturn Config\n'
    expect(restoredOver(helper, helper.replace('Speed = 5', 'Speed = 7'))).toBe(true)
  })

  it('treats UE4SS Key.X / ModifierKey.X as values unless the file rebinds Key', () => {
    const installed = 'local Config = {\n  Key = Key.F1,\n  Mods = { ModifierKey.CONTROL },\n}\nreturn Config\n'
    expect(restoredOver(installed, installed.replace('Key.F1', 'Key.F2').replace('CONTROL', 'ALT'))).toBe(true)
    expect(restoredOver(null, 'return { Key = Key.F5 }\n')).toBe(true)
    // Once Key is something else, Key.X is a read of that, i.e. code.
    expect(restoredOver(CONFIG_V1, 'local Key = os\nreturn { Key = Key.execute }\n')).toBe(false)
    expect(restoredOver(CONFIG_V1, '_ENV = { Key = "x" }\nreturn { Key = Key.rep }\n')).toBe(false)
  })

  it('keeps code the installed config.lua already has, Lua 5.4 <const>, and new data-only files', () => {
    const withCode = 'local K <const> = 5\nlocal Config = {\n  Key = Key.F1,\n  Max = K,\n  OnLoad = function() print("hi") end,\n}\nreturn Config\n'
    write(path.join(mods, 'CoolMod', 'Scripts', 'config.lua'), withCode)
    const edited = withCode.replace('local K <const> = 5', 'local K <const> = 9')
    restore({ CoolMod: { 'Scripts/config.lua': edited, 'settings/options-config.txt': 'a=1' } })
    expect(read(path.join(mods, 'CoolMod', 'Scripts', 'config.lua'))).toBe(edited)
    expect(read(path.join(mods, 'CoolMod', 'settings', 'options-config.txt'))).toBe('a=1')
  })
})

describe('profile snapshots leave the installed version\'s own files alone (gid 21)', () => {
  let mods
  beforeEach(() => {
    state.gamePath = root
    mods = path.join(root, 'Mods')
    state.modsPath = mods
    write(path.join(mods, 'CoolMod', 'Scripts', 'config.lua'), 'return {\n  A = 1,\n}\n')
    write(path.join(mods, 'CoolMod', 'hzmm.config.json'), '{"v":2}')
    write(path.join(mods, 'CoolMod', 'ModManifest.json'), '{"m":2}')
    write(path.join(mods, 'CoolMod', 'settings.ini'), 'x=1')
  })

  it('snapshot skips hzmm.config.json / modmanifest.json', () => {
    const snap = state.handlers.get('profiles:snapshot-configs')({})
    expect(Object.keys(snap.CoolMod).sort()).toEqual(['Scripts/config.lua', 'settings.ini'])
  })

  it('restoring an older profile that still holds them does not downgrade the schema', () => {
    write(path.join(mods, 'CoolMod', 'hzmm.config.json'), '{"v":3}')
    write(path.join(mods, 'CoolMod', 'ModManifest.json'), '{"m":3}')
    state.handlers.get('profiles:restore-configs')({}, {
      CoolMod: { 'hzmm.config.json': '{"v":2}', 'ModManifest.json': '{"m":2}', 'settings.ini': 'x=2' },
    })
    expect(read(path.join(mods, 'CoolMod', 'hzmm.config.json'))).toBe('{"v":3}')
    expect(read(path.join(mods, 'CoolMod', 'ModManifest.json'))).toBe('{"m":3}')
    expect(read(path.join(mods, 'CoolMod', 'settings.ini'))).toBe('x=2')
  })

  it('isSnapshotConfigFile mirrors the scan rule', () => {
    expect(isSnapshotConfigFile('Scripts/config.lua')).toBe(true)
    expect(isSnapshotConfigFile('Scripts\\Config.LUA')).toBe(true)
    expect(isSnapshotConfigFile('settings.ini')).toBe(true)
    expect(isSnapshotConfigFile('Scripts/main.lua')).toBe(false)
    expect(isSnapshotConfigFile('ENABLED.TXT')).toBe(false)
    expect(isSnapshotConfigFile('hzmm.config.json')).toBe(false)
    expect(isSnapshotConfigFile('dlls/main.dll')).toBe(false)
  })
})

describe('resolveModConfigPath refuses the mod folder itself', () => {
  it.each(['.', 'Scripts/..', './', '../MyMod'])('%s', (rel) => {
    expect(() => resolveModConfigPath(path.join(root, 'Mods'), 'MyMod', rel)).toThrow()
  })
})

describe('restoreArchivedVersion is all or nothing (gid 16)', () => {
  let paks, ue4ss, retention
  beforeEach(() => {
    paks = path.join(root, 'Paks')
    ue4ss = path.join(root, 'ue4ss', 'Mods')
    retention = path.join(root, 'mod-versions')
    for (const d of [paks, ue4ss, retention]) fs.mkdirSync(d, { recursive: true })
  })
  const P = () => ({ paksPaths: [paks], ue4ssModsPath: ue4ss, primaryPaksPath: paks })
  const RECEIPT = { modId: 7, fileId: 1, version: '1.0', localMods: [{ modType: 'PAK', name: 'Cool' }, { modType: 'UE4SS', name: 'CppMod' }] }

  function seed(tag) {
    write(path.join(paks, 'Cool_P.pak'), `pak ${tag}`)
    write(path.join(ue4ss, 'CppMod', 'dlls', 'main.dll'), `dll ${tag}`)
    write(path.join(ue4ss, 'CppMod', 'config.ini'), `ini ${tag}`)
  }
  function archiveV1ThenUpdateToV2() {
    seed('v1')
    const archived = archiveModVersion(P(), retention, RECEIPT, 1000)
    fs.rmSync(path.join(ue4ss, 'CppMod'), { recursive: true })
    seed('v2')
    return archived.dir
  }
  const leftovers = () => [...fs.readdirSync(paks), ...fs.readdirSync(path.dirname(ue4ss))]
    .filter(f => f.includes('hzmm-old'))

  it('a failed pak copy leaves the current pak in place and throws', () => {
    const dir = archiveV1ThenUpdateToV2()
    const realCopy = fs.copyFileSync
    vi.spyOn(fs, 'copyFileSync').mockImplementation((src, dest, ...rest) => {
      if (String(dest).startsWith(paks)) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
      return realCopy(src, dest, ...rest)
    })
    expect(() => restoreArchivedVersion(P(), dir)).toThrow(/ENOSPC/)
    vi.restoreAllMocks()
    expect(read(path.join(paks, 'Cool_P.pak'))).toBe('pak v2')
    expect(read(path.join(ue4ss, 'CppMod', 'config.ini'))).toBe('ini v2')
    expect(read(path.join(ue4ss, 'CppMod', 'dlls', 'main.dll'))).toBe('dll v2')
    expect(leftovers()).toEqual([])
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true)
  })

  it('a UE4SS folder the game holds (loaded DLL) is not half-deleted, and the pak is put back', () => {
    const dir = archiveV1ThenUpdateToV2()
    const busy = () => Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
    const dest = path.join(ue4ss, 'CppMod')
    const realRm = fs.rmSync
    const realRename = fs.renameSync
    // Windows: deleting the folder removes the unlocked files, then fails on
    // the loaded DLL; renaming it fails outright.
    vi.spyOn(fs, 'rmSync').mockImplementation((p, opts) => {
      if (path.resolve(String(p)) === dest) {
        realRm(path.join(dest, 'config.ini'), { force: true })
        throw busy()
      }
      return realRm(p, opts)
    })
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (path.resolve(String(from)) === dest) throw busy()
      return realRename(from, to)
    })
    expect(() => restoreArchivedVersion(P(), dir)).toThrow(/EBUSY/)
    vi.restoreAllMocks()
    expect(read(path.join(ue4ss, 'CppMod', 'config.ini'))).toBe('ini v2')
    expect(read(path.join(paks, 'Cool_P.pak'))).toBe('pak v2')
    expect(leftovers()).toEqual([])
  })

  it('an incomplete snapshot throws before anything is touched', () => {
    const dir = archiveV1ThenUpdateToV2()
    fs.rmSync(path.join(dir, 'ue4ss'), { recursive: true })
    expect(() => restoreArchivedVersion(P(), dir)).toThrow(/incomplete/)
    expect(read(path.join(paks, 'Cool_P.pak'))).toBe('pak v2')
    expect(read(path.join(ue4ss, 'CppMod', 'config.ini'))).toBe('ini v2')
  })

  it('a successful restore replaces everything and leaves no aside copies', () => {
    const dir = archiveV1ThenUpdateToV2()
    const restored = restoreArchivedVersion(P(), dir)
    expect(restored.localMods).toEqual(RECEIPT.localMods)
    expect(read(path.join(paks, 'Cool_P.pak'))).toBe('pak v1')
    expect(read(path.join(ue4ss, 'CppMod', 'config.ini'))).toBe('ini v1')
    expect(leftovers()).toEqual([])
  })

  it('clearPakNames moves the named current paks aside as part of the same restore', () => {
    const dir = archiveV1ThenUpdateToV2()
    write(path.join(paks, 'z1_CoolNew_P.pak'), 'renamed current')
    restoreArchivedVersion(P(), dir, { clearPakNames: ['z1_CoolNew'] })
    expect(fs.readdirSync(paks).sort()).toEqual(['Cool_P.pak'])
  })
})

describe('IoStore containers travel with the pak through archive and rollback (gid 28)', () => {
  let paks, retention
  beforeEach(() => {
    paks = path.join(root, 'Paks')
    retention = path.join(root, 'mod-versions')
    fs.mkdirSync(paks, { recursive: true })
  })
  const P = () => ({ paksPaths: [paks], ue4ssModsPath: null, primaryPaksPath: paks })
  const RECEIPT = { modId: 9, fileId: 1, version: '1', localMods: [{ modType: 'PAK', name: 'Io' }] }
  const seed = (tag, prefix = '') => {
    for (const ext of ['pak', 'ucas', 'utoc']) write(path.join(paks, `${prefix}Io_P.${ext}`), `${ext} ${tag}`)
  }
  const contents = () => fs.readdirSync(paks).sort().map(f => `${f}=${read(path.join(paks, f))}`)

  it('rolls back all three files', () => {
    seed('v1')
    archiveModVersion(P(), retention, RECEIPT, 1000)
    seed('v2')
    restoreArchivedVersion(P(), listModVersions(retention)['9'][0].dir)
    expect(contents()).toEqual(['Io_P.pak=pak v1', 'Io_P.ucas=ucas v1', 'Io_P.utoc=utoc v1'])
  })

  it('keeps each container\'s disabled form and clears a load-order-renamed current copy', () => {
    write(path.join(paks, 'Io_P.pak.disabled'), 'pak v1')
    write(path.join(paks, 'Io_P.ucas.disabled'), 'ucas v1')
    write(path.join(paks, 'Io_P.utoc.disabled'), 'utoc v1')
    archiveModVersion(P(), retention, RECEIPT, 1000)
    for (const f of fs.readdirSync(paks)) fs.rmSync(path.join(paks, f))
    seed('v2', 'z1_')
    restoreArchivedVersion(P(), listModVersions(retention)['9'][0].dir)
    expect(contents()).toEqual(['Io_P.pak.disabled=pak v1', 'Io_P.ucas.disabled=ucas v1', 'Io_P.utoc.disabled=utoc v1'])
  })

  // A manifest from before `files` existed: only the .pak was archived.
  function legacySnapshot(tag) {
    write(path.join(paks, 'Io_P.pak'), `pak ${tag}`)
    const { dir } = archiveModVersion(P(), retention, RECEIPT, 1000)
    const manifestPath = path.join(dir, 'manifest.json')
    const manifest = JSON.parse(read(manifestPath))
    delete manifest.entries[0].files
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    return dir
  }

  it('still restores a manifest written before `files` existed', () => {
    const dir = legacySnapshot('v1')
    write(path.join(paks, 'Io_P.pak'), 'pak v2')
    restoreArchivedVersion(P(), dir)
    expect(contents()).toEqual(['Io_P.pak=pak v1'])
  })

  it('refuses a pre-`files` snapshot when the current version has IoStore containers, touching nothing', () => {
    const dir = legacySnapshot('v1')
    seed('v2')
    expect(() => restoreArchivedVersion(P(), dir)).toThrow(/ucas\/\.utoc/)
    expect(contents()).toEqual(['Io_P.pak=pak v2', 'Io_P.ucas=ucas v2', 'Io_P.utoc=utoc v2'])
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true)
  })

  it('archives a load-order-prefixed pak with its containers and restores it', () => {
    seed('v1', 'z1_')
    const archived = archiveModVersion(P(), retention, RECEIPT, 1000)
    expect(archived).not.toBeNull()
    const manifest = JSON.parse(read(path.join(archived.dir, 'manifest.json')))
    expect(manifest.entries[0].filename).toBe('z1_Io_P.pak')
    expect([...manifest.entries[0].files].sort()).toEqual(['z1_Io_P.pak', 'z1_Io_P.ucas', 'z1_Io_P.utoc'])
    for (const f of fs.readdirSync(paks)) fs.rmSync(path.join(paks, f))
    seed('v2')
    restoreArchivedVersion(P(), archived.dir)
    expect(contents()).toEqual(['z1_Io_P.pak=pak v1', 'z1_Io_P.ucas=ucas v1', 'z1_Io_P.utoc=utoc v1'])
  })

  it('restores a file two receipt names share (Io / Io_P) once instead of failing', () => {
    write(path.join(paks, 'Io_P.pak'), 'pak v1')
    const receipt = { ...RECEIPT, localMods: [{ modType: 'PAK', name: 'Io' }, { modType: 'PAK', name: 'Io_P' }] }
    const { dir } = archiveModVersion(P(), retention, receipt, 1000)
    write(path.join(paks, 'Io_P.pak'), 'pak v2')
    restoreArchivedVersion(P(), dir)
    expect(contents()).toEqual(['Io_P.pak=pak v1'])
  })

  it('removePakVariants clears the containers and prefixed forms too', () => {
    seed('x')
    seed('y', 'z1_')
    write(path.join(paks, 'Other_P.pak'), 'keep')
    expect(removePakVariants([paks], 'Io')).toBe(6)
    expect(fs.readdirSync(paks)).toEqual(['Other_P.pak'])
  })
})
