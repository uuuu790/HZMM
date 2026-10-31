// Regression tests for the archive analysis / install fixes (cluster A1):
// classification vs. install-branch agreement, rollback, decompression-bomb
// guard on real output bytes, collision copies, RAR temp extraction, and the
// bounded readme read. Archives are built in-process (tiny zip / RAR4 writers
// below) and installed into a throwaway game folder.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Buffer } from 'buffer'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'

const state = vi.hoisted(() => ({ gamePath: null, cfgDir: null }))
vi.mock('electron', () => ({ net: {}, app: {}, ipcMain: { handle() {} } }))
vi.mock('../../src/main/services/config-store', () => ({
  default: { get: (k, d) => (k === 'gamePath' ? state.gamePath : d), set() {}, getConfigDir: () => state.cfgDir },
}))
vi.mock('../../src/main/services/logger', () => ({ default: { info() {}, warn() {}, error() {}, debug() {} } }))
vi.mock('../../src/main/ipc/mods-scan', () => ({ invalidateCache() {} }))
vi.mock('../../src/main/services/readme-utils', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, normalizeReadme: vi.fn(actual.normalizeReadme) }
})

const { installMods } = await import('../../src/main/ipc/mods-install')
const { analyzeArchiveStructure, extractZip, extractZipRaw, extractRar } = await import('../../src/main/services/archive')
const { normalizeReadme } = await import('../../src/main/services/readme-utils')

// --- fixture writers -------------------------------------------------------

// Minimal zip writer. Per entry: { name, data, deflate, bit3, cdSize }.
// `bit3` sets the data-descriptor flag (local header sizes/CRC zeroed);
// `cdSize` overrides the uncompressed size recorded in the central directory.
function buildZip(items) {
  const locals = []
  const central = []
  let offset = 0
  for (const it of items) {
    const name = Buffer.from(it.name, 'utf8')
    const data = Buffer.isBuffer(it.data) ? it.data : Buffer.from(it.data ?? '')
    const method = it.deflate ? 8 : 0
    const comp = it.deflate ? zlib.deflateRawSync(data) : data
    const crc = zlib.crc32(data)
    const flags = it.bit3 ? 0x08 : 0
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(flags, 6)
    lh.writeUInt16LE(method, 8)
    lh.writeUInt16LE(0x21, 12)
    if (!it.bit3) {
      lh.writeUInt32LE(crc, 14)
      lh.writeUInt32LE(comp.length, 18)
      lh.writeUInt32LE(data.length, 22)
    }
    lh.writeUInt16LE(name.length, 26)
    let dd = Buffer.alloc(0)
    if (it.bit3) {
      dd = Buffer.alloc(16)
      dd.writeUInt32LE(0x08074b50, 0)
      dd.writeUInt32LE(crc, 4)
      dd.writeUInt32LE(comp.length, 8)
      dd.writeUInt32LE(data.length, 12)
    }
    const local = Buffer.concat([lh, name, comp, dd])
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(flags, 8)
    cd.writeUInt16LE(method, 10)
    cd.writeUInt16LE(0x21, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(comp.length, 20)
    cd.writeUInt32LE(it.cdSize ?? data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE(it.name.endsWith('/') ? 0x10 : 0, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cd, name]))
    locals.push(local)
    offset += local.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(items.length, 8)
  eocd.writeUInt16LE(items.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cdBuf, eocd])
}

// Minimal RAR 4.x writer, stored files only.
function buildRar4(entries) {
  const crc16 = (b) => zlib.crc32(b) & 0xffff
  const withCrc = (body) => {
    const c = Buffer.alloc(2)
    c.writeUInt16LE(crc16(body))
    return [c, body]
  }
  const main = Buffer.alloc(11)
  main.writeUInt8(0x73, 0)
  main.writeUInt16LE(13, 3)
  const parts = [Buffer.from('Rar!\x1a\x07\x00', 'latin1'), ...withCrc(main)]
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content)
    const nm = Buffer.from(name)
    const body = Buffer.alloc(30 + nm.length)
    body.writeUInt8(0x74, 0)
    body.writeUInt16LE(0x8000, 1)
    body.writeUInt16LE(32 + nm.length, 3)
    body.writeUInt32LE(data.length, 5)
    body.writeUInt32LE(data.length, 9)
    body.writeUInt8(3, 13)
    body.writeUInt32LE(zlib.crc32(data), 14)
    body.writeUInt32LE(0x5a210000, 18)
    body.writeUInt8(20, 22)
    body.writeUInt8(0x30, 23)
    body.writeUInt16LE(nm.length, 24)
    body.writeUInt32LE(0o100644, 26)
    nm.copy(body, 30)
    parts.push(...withCrc(body), data)
  }
  const end = Buffer.alloc(5)
  end.writeUInt8(0x7b, 0)
  end.writeUInt16LE(0x4000, 1)
  end.writeUInt16LE(7, 3)
  parts.push(...withCrc(end))
  return Buffer.concat(parts)
}

// --- throwaway game folder --------------------------------------------------

let g
beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-a1-'))
  const game = path.join(root, 'game')
  const mods = path.join(game, 'HumanitZ', 'Content', 'Paks', '~mods')
  const ue = path.join(game, 'HumanitZ', 'Binaries', 'Win64', 'ue4ss', 'Mods')
  const cfg = path.join(root, 'cfg')
  const archives = path.join(root, 'archives')
  for (const d of [mods, ue, cfg, archives]) fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(ue, 'mods.txt'), '; comment\n')
  fs.writeFileSync(path.join(ue, 'mods.json'), '[]')
  g = { root, game, mods, ue, cfg, archives }
  state.gamePath = game
  state.cfgDir = cfg
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(g.root, { recursive: true, force: true })
})

// Write a zip of { name: content } into the archives folder.
function zipOf(fileName, entries) {
  const p = path.join(g.archives, fileName)
  fs.writeFileSync(p, buildZip(Object.entries(entries).map(([name, data]) => ({ name, data, deflate: true }))))
  return p
}
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8')
const exists = (...p) => fs.existsSync(path.join(...p))
const modsTxt = () => read(g.ue, 'mods.txt')
const nonGameRoot = () => fs.readdirSync(g.game).filter(n => n !== 'HumanitZ')

describe('cppmod + pak archives (gid 0)', () => {
  it('classifies <Mod>/dlls/main.dll shipped with a pak as hybrid', () => {
    const a = analyzeArchiveStructure(['MyMod/dlls/main.dll', 'MyMod/enabled.txt', 'MyMod_P.pak'])
    expect(a.type).toBe('hybrid')
    expect(a.mods).toEqual([{ name: 'MyMod', modType: 'PAK' }, { name: 'MyMod', modType: 'UE4SS' }])
  })

  it('updates both halves in place instead of dumping them into the game root', async () => {
    fs.writeFileSync(path.join(g.mods, 'MyMod_P.pak'), 'OLD-PAK')
    fs.mkdirSync(path.join(g.ue, 'MyMod', 'dlls'), { recursive: true })
    fs.writeFileSync(path.join(g.ue, 'MyMod', 'dlls', 'main.dll'), 'OLD-DLL')
    const zip = zipOf('MyMod-v2.zip', { 'MyMod/dlls/main.dll': 'NEW-DLL', 'MyMod/enabled.txt': '', 'MyMod_P.pak': 'NEW-PAK' })
    const [res] = await installMods([zip], null)
    expect(res.type).toBe('hybrid')
    expect(read(g.ue, 'MyMod', 'dlls', 'main.dll')).toBe('NEW-DLL')
    expect(read(g.mods, 'MyMod_P.pak')).toBe('NEW-PAK')
    expect(nonGameRoot()).toEqual([])
  })

  it('a root-extracted (complex) archive leaves live copies it does not replace alone', async () => {
    fs.writeFileSync(path.join(g.mods, 'MyMod_P.pak'), 'OLD-PAK')
    const zip = zipOf('odd.zip', { 'MyMod_P.pak': 'NEW-PAK', 'helper.dll': 'MZ' })
    const [res] = await installMods([zip], null)
    expect(res.type).toBe('complex')
    expect(read(g.mods, 'MyMod_P.pak')).toBe('OLD-PAK')
  })
})

describe('withRollback backup cleanup (gid 1)', () => {
  it('a locked backup folder does not roll back a completed install', async () => {
    for (const ext of ['pak', 'ucas', 'utoc']) fs.writeFileSync(path.join(g.mods, `Cool_P.${ext}`), `OLD-${ext}`)
    const zip = zipOf('Cool.zip', { 'Cool_P.pak': 'NEW-pak', 'Cool_P.ucas': 'NEW-ucas', 'Cool_P.utoc': 'NEW-utoc' })
    const realRm = fs.rmSync
    vi.spyOn(fs, 'rmSync').mockImplementation((p, o) => {
      if (String(p).includes('install-rollback')) {
        const e = new Error('EBUSY: resource busy or locked')
        e.code = 'EBUSY'
        throw e
      }
      return realRm(p, o)
    })
    await expect(installMods([zip], null)).resolves.toHaveLength(1)
    for (const ext of ['pak', 'ucas', 'utoc']) expect(read(g.mods, `Cool_P.${ext}`)).toBe(`NEW-${ext}`)
  })
})

describe('decompression-bomb guard on real output (gid 2)', () => {
  const big = Buffer.alloc(32 * 1024 * 1024)
  const writeBomb = (name, item) => {
    const p = path.join(g.archives, name)
    fs.writeFileSync(p, buildZip([{ data: big, deflate: true, cdSize: 1, ...item }]))
    return p
  }

  it('rejects a data-descriptor (bit 3) entry that inflates past its declared size', async () => {
    const zip = writeBomb('bomb.zip', { name: 'bomb.bin', bit3: true })
    const dest = path.join(g.root, 'out')
    await expect(extractZip(zip, dest)).rejects.toThrow(/declared size/)
    expect(exists(dest, 'bomb.bin')).toBe(false)
  })

  it('rejects an entry whose central-directory size disagrees with the local header', async () => {
    const zip = writeBomb('mismatch.zip', { name: 'Cool_P.pak' })
    const dest = path.join(g.root, 'out')
    await expect(extractZip(zip, dest)).rejects.toThrow(/declared size/)
    expect(fs.readdirSync(dest)).toEqual([])
  })

  it('guards extractZipRaw (UE4SS deploy) too', async () => {
    const zip = writeBomb('raw.zip', { name: 'ue4ss/UE4SS.dll', bit3: true })
    await expect(extractZipRaw(zip, path.join(g.root, 'raw'))).rejects.toThrow(/declared size/)
  })

  it('a bomb pak rolls the install back to the old version', async () => {
    fs.writeFileSync(path.join(g.mods, 'Cool_P.pak'), 'OLD-PAK')
    const zip = writeBomb('Cool.zip', { name: 'Cool_P.pak', bit3: true })
    await expect(installMods([zip], null)).rejects.toThrow(/declared size/)
    expect(fs.readdirSync(g.mods)).toEqual(['Cool_P.pak'])
    expect(read(g.mods, 'Cool_P.pak')).toBe('OLD-PAK')
  })

  it('still extracts honest bit-3 and stored entries', async () => {
    const p = path.join(g.archives, 'ok.zip')
    fs.writeFileSync(p, buildZip([
      { name: 'Mod/', data: '' },
      { name: 'Mod/a.txt', data: 'hello '.repeat(1000), deflate: true, bit3: true },
      { name: 'Mod/b.txt', data: 'stored' },
      { name: 'Mod/empty.txt', data: '' },
    ]))
    const dest = path.join(g.root, 'ok')
    await extractZip(p, dest)
    expect(read(dest, 'Mod', 'a.txt')).toBe('hello '.repeat(1000))
    expect(read(dest, 'Mod', 'b.txt')).toBe('stored')
    expect(read(dest, 'Mod', 'empty.txt')).toBe('')
  })
})

describe('root-level UE4SS archives (gid 3)', () => {
  it('installs a root Scripts/main.lua mod under the archive name', async () => {
    const zip = zipOf('CoolMod.zip', { 'Scripts/main.lua': 'print(1)', 'enabled.txt': '' })
    const [res] = await installMods([zip], null)
    expect(res.mods).toEqual([{ name: 'CoolMod', modType: 'UE4SS' }])
    expect(read(g.ue, 'CoolMod', 'Scripts', 'main.lua')).toBe('print(1)')
    expect(exists(g.ue, 'CoolMod', 'enabled.txt')).toBe(true)
    expect(exists(g.ue, 'Scripts')).toBe(false)
    expect(modsTxt()).toContain('CoolMod : 1')
    expect(modsTxt()).not.toContain('Scripts')
  })

  it('installs a root main.lua mod instead of reporting success with nothing installed', async () => {
    const zip = zipOf('CoolLua.zip', { 'main.lua': 'print(1)', 'enabled.txt': '' })
    await installMods([zip], null)
    expect(read(g.ue, 'CoolLua', 'main.lua')).toBe('print(1)')
    expect(modsTxt()).toContain('CoolLua : 1')
  })

  it('a hybrid whose root is the mod keeps its paks out of the UE4SS folder', async () => {
    const zip = zipOf('Cool.zip', { 'Scripts/main.lua': 'print(1)', 'enabled.txt': '', 'Cool_P.pak': 'PAK' })
    const [res] = await installMods([zip], null)
    expect(res.type).toBe('hybrid')
    expect(read(g.mods, 'Cool_P.pak')).toBe('PAK')
    expect(fs.readdirSync(path.join(g.ue, 'Cool')).sort()).toEqual(['Scripts', '_hzmm_link.json', 'enabled.txt'])
  })

  it('rejects an archive with no recognizable UE4SS mod folder', async () => {
    const zip = zipOf('CoolDll.zip', { 'Cool.dll': 'MZ' })
    await expect(installMods([zip], null)).rejects.toThrow(/No UE4SS mod folder/)
  })

  it('does not delete a live mod the archive cannot replace', async () => {
    fs.mkdirSync(path.join(g.ue, 'Cool', 'Scripts'), { recursive: true })
    fs.writeFileSync(path.join(g.ue, 'Cool', 'Scripts', 'main.lua'), 'OLD')
    const zip = zipOf('Cool.zip', { 'Cool/enabled.txt': '', 'Cool/Scripts/init.lua': 'x' })
    await expect(installMods([zip], null)).rejects.toThrow(/No UE4SS mod folder/)
    expect(read(g.ue, 'Cool', 'Scripts', 'main.lua')).toBe('OLD')
  })
})

describe('same-basename pak collision copies (gid 4)', () => {
  it('reinstalling replaces the " (2)" copy instead of piling up more', async () => {
    await installMods([zipOf('v1.zip', { 'OptionA/Cool_P.pak': 'A-v1', 'OptionB/Cool_P.pak': 'B-v1' })], null)
    await installMods([zipOf('v2.zip', { 'OptionA/Cool_P.pak': 'A-v2', 'OptionB/Cool_P.pak': 'B-v2' })], null)
    const paks = fs.readdirSync(g.mods).sort()
    expect(paks).toEqual(['Cool_P (2).pak', 'Cool_P.pak'])
    expect(paks.map(p => read(g.mods, p)).sort()).toEqual(['A-v2', 'B-v2'])
  })
})

describe('UE4SS bundles in a wrapper folder (gids 5, 6)', () => {
  const bundle = (pfx) => ({
    [`${pfx}HumanitZ/Binaries/Win64/dwmapi.dll`]: 'MZ',
    [`${pfx}HumanitZ/Binaries/Win64/ue4ss/UE4SS.dll`]: 'MZ',
    [`${pfx}HumanitZ/Binaries/Win64/ue4ss/Mods/MyMod/Scripts/main.lua`]: 'print(1)',
    [`${pfx}HumanitZ/Binaries/Win64/ue4ss/Mods/MyMod/enabled.txt`]: '',
  })

  it('detects the game structure under a single wrapper folder', () => {
    const a = analyzeArchiveStructure(Object.keys(bundle('MyMod v1.0/')))
    expect(a.gameStructurePrefix).toBe('MyMod v1.0/')
    expect(a.mods).toEqual([{ name: 'MyMod', modType: 'UE4SS' }])
  })

  it('installs a wrapped bundle into the game tree, not Mods/Win64', async () => {
    await installMods([zipOf('wrapped.zip', bundle('MyMod v1.0/'))], null)
    expect(read(g.ue, 'MyMod', 'Scripts', 'main.lua')).toBe('print(1)')
    expect(exists(g.game, 'HumanitZ', 'Binaries', 'Win64', 'dwmapi.dll')).toBe(true)
    expect(exists(g.ue, 'Win64')).toBe(false)
    expect(nonGameRoot()).toEqual([])
    expect(modsTxt()).toBe('; comment\nMyMod : 1\n')
  })

  it('registers the mod of a bundle that brings UE4SS to a game without it', async () => {
    fs.rmSync(path.join(g.game, 'HumanitZ', 'Binaries'), { recursive: true, force: true })
    await installMods([zipOf('fresh.zip', { ...bundle(''), 'HumanitZ/Binaries/Win64/ue4ss/Mods/mods.txt': '; comment\n' })], null)
    expect(read(g.ue, 'MyMod', 'Scripts', 'main.lua')).toBe('print(1)')
    expect(modsTxt()).toBe('; comment\nMyMod : 1\n')
  })

  it('registers only the real mod for an unwrapped bundle (no Win64 / ue4ss entries)', async () => {
    await installMods([zipOf('plain.zip', bundle(''))], null)
    expect(modsTxt()).toBe('; comment\nMyMod : 1\n')
    expect(JSON.parse(read(g.ue, 'mods.json')).map(m => m.mod_name)).toEqual(['MyMod'])
  })

  it('a native Lua module inside a mod does not become a mod of its own', async () => {
    const zip = zipOf('sock.zip', {
      'MyMod/Scripts/main.lua': 'print(1)',
      'MyMod/Scripts/lib/socket/core.dll': 'MZ',
      'MyMod/enabled.txt': '',
    })
    const [res] = await installMods([zip], null)
    expect(res.mods).toEqual([{ name: 'MyMod', modType: 'UE4SS' }])
    expect(modsTxt()).toBe('; comment\nMyMod : 1\n')
    expect(exists(g.ue, 'MyMod', 'Scripts', 'lib', 'socket', 'core.dll')).toBe(true)
  })
})

describe('hybrid install with an uppercase .PAK (gid 7)', () => {
  it('copies MyMod_P.PAK into ~mods', async () => {
    fs.writeFileSync(path.join(g.mods, 'MyMod_P.PAK'), 'OLD-PAK')
    const zip = zipOf('hybrid.zip', { 'MyMod/Scripts/main.lua': 'print(1)', 'MyMod/enabled.txt': '', 'MyMod_P.PAK': 'NEW-PAK' })
    const [res] = await installMods([zip], null)
    expect(res.type).toBe('hybrid')
    expect(read(g.mods, 'MyMod_P.PAK')).toBe('NEW-PAK')
    expect(JSON.parse(read(g.ue, 'MyMod', '_hzmm_link.json'))).toEqual({ pakFiles: ['MyMod_P.PAK'] })
  })
})

describe('IoStore triplets (gid 10)', () => {
  it('report one mod, not three', () => {
    expect(analyzeArchiveStructure(['Cool_P.pak', 'Cool_P.ucas', 'Cool_P.utoc']).mods).toEqual([{ name: 'Cool', modType: 'PAK' }])
  })
})

describe('RAR pak-only extraction (gid 12)', () => {
  it('leaves no sub-folders behind in the destination', async () => {
    const rar = path.join(g.archives, 'mod.rar')
    fs.writeFileSync(rar, buildRar4({ 'Cool v2/Paks/Cool_P.pak': 'PAK', 'Cool v2/readme.txt': 'hi' }))
    const dest = path.join(g.root, 'rar-out')
    fs.mkdirSync(dest)
    const analysis = await extractRar(rar, dest)
    expect(analysis.type).toBe('pak-only')
    expect(fs.readdirSync(dest)).toEqual(['Cool_P.pak'])
    expect(read(dest, 'Cool_P.pak')).toBe('PAK')
  })
})

// Review follow-ups: the gid-0 "rotate only what the root extract replaces"
// rule and the cppmod+pak reclassification must not regress game-structure
// installs that worked before.
describe('game-structure updates replace the old pak (review issue 1)', () => {
  const paksRoot = () => path.join(g.game, 'HumanitZ', 'Content', 'Paks')

  it('rotates the old pak out of Paks/ when the archive brings the first ~mods', async () => {
    fs.rmSync(g.mods, { recursive: true, force: true })
    fs.writeFileSync(path.join(paksRoot(), 'Cool_P.pak'), 'OLD-PAK')
    await installMods([zipOf('Cool.zip', { 'HumanitZ/Content/Paks/~mods/Cool_P.pak': 'NEW-PAK' })], null)
    expect(fs.readdirSync(paksRoot())).toEqual(['~mods'])
    expect(read(g.mods, 'Cool_P.pak')).toBe('NEW-PAK')
  })

  it('rotates the old ~mods pak when the new one lands in a ~mods subfolder', async () => {
    fs.writeFileSync(path.join(g.mods, 'Cool_P.pak'), 'OLD-PAK')
    await installMods([zipOf('Cool.zip', { 'HumanitZ/Content/Paks/~mods/Cool/Cool_P.pak': 'NEW-PAK' })], null)
    expect(fs.readdirSync(g.mods)).toEqual(['Cool'])
    expect(read(g.mods, 'Cool', 'Cool_P.pak')).toBe('NEW-PAK')
  })

  it('leaves the live pak alone when the archive writes a Paks tree the game does not use', async () => {
    fs.writeFileSync(path.join(g.mods, 'Cool_P.pak'), 'OLD-PAK')
    const zip = zipOf('odd.zip', { 'Content/Paks/~mods/Cool_P.pak': 'NEW-PAK', 'helper.dll': 'MZ' })
    const [res] = await installMods([zip], null)
    expect(res.type).toBe('complex')
    expect(read(g.mods, 'Cool_P.pak')).toBe('OLD-PAK')
  })
})

describe('cppmod + pak bundle that brings UE4SS (review issue 2)', () => {
  it('installs on a game without UE4SS and links / registers the mod', async () => {
    fs.rmSync(path.join(g.game, 'HumanitZ', 'Binaries'), { recursive: true, force: true })
    fs.writeFileSync(path.join(g.mods, 'CppMod_P.pak'), 'OLD-PAK')
    const zip = zipOf('bundle.zip', {
      'HumanitZ/Binaries/Win64/dwmapi.dll': 'MZ',
      'HumanitZ/Binaries/Win64/ue4ss/UE4SS.dll': 'MZ',
      'HumanitZ/Binaries/Win64/ue4ss/Mods/mods.txt': '; comment\n',
      'HumanitZ/Binaries/Win64/ue4ss/Mods/CppMod/dlls/main.dll': 'NEW-DLL',
      'HumanitZ/Content/Paks/~mods/CppMod_P.pak': 'NEW-PAK',
    })
    const [res] = await installMods([zip], null)
    expect(res.type).toBe('hybrid')
    expect(read(g.ue, 'CppMod', 'dlls', 'main.dll')).toBe('NEW-DLL')
    expect(fs.readdirSync(g.mods)).toEqual(['CppMod_P.pak'])
    expect(read(g.mods, 'CppMod_P.pak')).toBe('NEW-PAK')
    expect(JSON.parse(read(g.ue, 'CppMod', '_hzmm_link.json'))).toEqual({ pakFiles: ['CppMod_P.pak'] })
    expect(modsTxt()).toBe('; comment\nCppMod : 1\n')
  })

  it('still asks for UE4SS when a non-game-structure hybrid has nowhere to go', async () => {
    fs.rmSync(path.join(g.game, 'HumanitZ', 'Binaries'), { recursive: true, force: true })
    fs.writeFileSync(path.join(g.mods, 'MyMod_P.pak'), 'OLD-PAK')
    const zip = zipOf('MyMod.zip', { 'MyMod/dlls/main.dll': 'DLL', 'MyMod_P.pak': 'NEW-PAK' })
    await expect(installMods([zip], null)).rejects.toThrow(/install UE4SS first/)
    expect(read(g.mods, 'MyMod_P.pak')).toBe('OLD-PAK')
  })
})

describe('wrapped game-structure archives (review issue 3)', () => {
  it('installs only the HumanitZ/ tree, not the files next to it', async () => {
    fs.writeFileSync(path.join(g.mods, 'Cool_P.pak'), 'OLD-PAK')
    fs.writeFileSync(path.join(g.mods, 'Alt_P.pak'), 'LIVE-ALT')
    fs.mkdirSync(path.join(g.cfg, 'readmes'))
    fs.writeFileSync(path.join(g.cfg, 'readmes', 'Alt.txt'), 'ALT README')
    const zip = zipOf('Cool.zip', {
      'Cool v2/HumanitZ/Content/Paks/~mods/Cool_P.pak': 'NEW-PAK',
      'Cool v2/readme.txt': 'hi',
      'Cool v2/screens/a.png': 'PNG',
      'Cool v2/optional/Alt_P.pak': 'OPTIONAL-ALT',
    })
    const [res] = await installMods([zip], null)
    expect(res.type).toBe('game-structure')
    expect(nonGameRoot()).toEqual([])
    expect(read(g.mods, 'Cool_P.pak')).toBe('NEW-PAK')
    // Not part of what lands, so the live copy is neither rotated nor replaced,
    // and keeps its own readme.
    expect(read(g.mods, 'Alt_P.pak')).toBe('LIVE-ALT')
    expect(read(g.cfg, 'readmes', 'Alt.txt')).toBe('ALT README')
    expect(read(g.cfg, 'readmes', 'Cool.txt')).toBe('hi')
  })

  it('links a wrapped cppmod + pak bundle only to the paks it installed', async () => {
    const zip = zipOf('bundle.zip', {
      'Pack/HumanitZ/Binaries/Win64/ue4ss/Mods/CppMod/dlls/main.dll': 'DLL',
      'Pack/HumanitZ/Content/Paks/~mods/CppMod_P.pak': 'PAK',
      'Pack/optional/Alt_P.pak': 'ALT',
    })
    const [res] = await installMods([zip], null)
    expect(res.type).toBe('hybrid')
    expect(nonGameRoot()).toEqual([])
    expect(JSON.parse(read(g.ue, 'CppMod', '_hzmm_link.json'))).toEqual({ pakFiles: ['CppMod_P.pak'] })
  })
})

describe('root-level UE4SS mods named after a Nexus download (review issue 4)', () => {
  const rootMod = (name, body) => zipOf(name, { 'Scripts/main.lua': body, 'enabled.txt': '' })

  it('drops the Nexus id/version/timestamp and browser copy suffixes from the name', async () => {
    for (const [file, name] of [
      ['CoolMod-56-1-0-1700000000.zip', 'CoolMod'],
      ['CoolMod-56-1-0-1700000000 (1).zip', 'CoolMod'],
      ['Cool Mod-56-2-0b-1700000000.zip', 'Cool Mod'],
      ['HZ-2077-Mod-56-1-0-1700000000.zip', 'HZ-2077-Mod'],
      ['CoolMod-56-beta-1700000000.zip', 'CoolMod'],
      ['CoolMod.zip', 'CoolMod'],
    ]) {
      const a = await extractZip(rootMod(file, 'x'), null, true)
      expect(a.ue4ssModDirs, file).toEqual([{ name, dir: '' }])
    }
  })

  it('an update of the same Nexus mod replaces the installed folder instead of adding a second', async () => {
    await installMods([rootMod('CoolMod-56-1-0-1700000000.zip', 'print("v1")')], null)
    await installMods([rootMod('CoolMod-56-1-1-1710000000.zip', 'print("v2")')], null)
    expect(fs.readdirSync(g.ue).sort()).toEqual(['CoolMod', 'mods.json', 'mods.txt'])
    expect(read(g.ue, 'CoolMod', 'Scripts', 'main.lua')).toBe('print("v2")')
    expect(modsTxt()).toBe('; comment\nCoolMod : 1\n')
  })
})

describe('readme caching (gid 13)', () => {
  it('reads only the head of a huge readme', async () => {
    normalizeReadme.mockClear()
    const zip = zipOf('Cool.zip', { 'Cool_P.pak': 'PAK', 'readme.txt': 'a'.repeat(3 * 1024 * 1024) })
    await installMods([zip], null)
    expect(normalizeReadme).toHaveBeenCalledTimes(1)
    expect(normalizeReadme.mock.calls[0][0].length).toBeLessThanOrEqual(5000 * 4 + 3)
    expect(read(g.cfg, 'readmes', 'Cool.txt')).toBe('a'.repeat(5000))
  })
})
