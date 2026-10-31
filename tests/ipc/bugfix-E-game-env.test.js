// Regression tests for the game-environment cluster (E):
//   - UE4SS deploy: a failed rotation is rolled back, a leftover backup is
//     recovered, the user's mods.txt / mods.json survive an update, and
//     install-from-file refuses zips not laid out for Win64
//   - UE4SS status ignores a lone non-UE4SS proxy DLL
//   - getUe4ssModsPath finds the flat (3.0.1) Mods folder
//   - game:set-path wants the game root, not any folder with an .exe
//   - Steam News: a response stream error is handled; a failed fetch keeps
//     the cached version name of the same build
//   - getSteamPath: HKCU SteamPath, existence check, non-ASCII paths
//     (including reg.exe's lossy '?' and best-fit output)
//   - isGameRunning: a failed tasklist is "unknown", not "exited"; a
//     tasklist that never works still lets a pending vanilla set restore
//   - saves:restore-backup is all-or-nothing
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { Buffer } from 'buffer'
import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'

const state = vi.hoisted(() => ({
  handlers: new Map(),
  config: {},
  cfgDir: null,
  releaseZip: null,
  pick: null,
  exec: null,
  execFileSync: null,
  netScript: null,
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel, fn) => state.handlers.set(channel, fn) },
  dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [state.pick] }) },
  shell: { openExternal: async () => {} },
  app: { getLocale: () => 'en', getPath: () => state.cfgDir, getVersion: () => '0.0.0-test', isPackaged: false },
  net: {
    request: () => {
      const req = new EventEmitter()
      req.setHeader = () => {}
      req.abort = () => {}
      req.write = () => {}
      req.end = () => { Promise.resolve().then(() => state.netScript(req)) }
      return req
    },
  },
}))
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal()),
  exec: (cmd, opts, cb) => state.exec(cmd, opts, cb),
  execFileSync: (file, args, opts) => state.execFileSync(file, args, opts),
}))
vi.mock('../../src/main/services/config-store', () => ({
  default: {
    get: (k, d) => (k in state.config ? state.config[k] : d),
    set: (k, v) => { state.config[k] = v },
    getConfigDir: () => state.cfgDir,
  },
}))
vi.mock('../../src/main/services/logger', () => ({ default: { info() {}, warn() {}, error() {}, debug() {} } }))
vi.mock('../../src/main/services/github-release', () => ({
  getLatestRelease: async () => ({ version: 'experimental-latest', publishedAt: 'P1', downloadUrl: 'https://example.invalid/ue4ss.zip' }),
  downloadRelease: async (_url, dest) => {
    const { copyFileSync } = await import('fs')
    copyFileSync(state.releaseZip, dest)
  },
}))
vi.mock('../../src/main/ipc/mods-install', () => ({ serializeModWrite: (fn) => Promise.resolve().then(fn) }))
vi.mock('../../src/main/ipc/mods-scan', () => ({ scanMods: () => [], invalidateCache: () => {} }))

const { registerUe4ssIpc } = await import('../../src/main/ipc/ue4ss')
const { registerGameIpc, startGameRunningPolling } = await import('../../src/main/ipc/game')
const { registerSavesIpc } = await import('../../src/main/ipc/saves')
const { isGameRunning } = await import('../../src/main/services/process-detector')
const { getUe4ssModsPath } = await import('../../src/main/services/steam-detector')
const { readUe4ssEnabledNames } = await import('../../src/main/ipc/mods-registry')

beforeAll(() => {
  registerUe4ssIpc(null)
  registerGameIpc()
  registerSavesIpc(null)
})

const invoke = (channel, ...args) => state.handlers.get(channel)({}, ...args)

// Minimal stored-entry zip writer. `badCrc` records a wrong CRC so that
// entry fails to extract after the ones before it were written.
function buildZip(entries) {
  const locals = []
  const central = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const data = Buffer.from(e.data ?? '')
    const crc = e.badCrc ? (zlib.crc32(data) ^ 0xffffffff) >>> 0 : zlib.crc32(data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(data.length, 18)
    lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(name.length, 26)
    const local = Buffer.concat([lh, name, data])
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE(e.name.endsWith('/') ? 0x10 : 0, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cd, name]))
    locals.push(local)
    offset += local.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cdBuf, eocd])
}

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
}
const read = (p) => fs.readFileSync(p, 'utf-8')

let root, gameRoot, bin

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-e-'))
  state.cfgDir = path.join(root, 'cfg')
  fs.mkdirSync(state.cfgDir, { recursive: true })
  gameRoot = path.join(root, 'steamapps', 'common', 'HumanitZ')
  bin = path.join(gameRoot, 'HumanitZ', 'Binaries', 'Win64')
  fs.mkdirSync(path.join(gameRoot, 'HumanitZ', 'Content', 'Paks'), { recursive: true })
  write(path.join(gameRoot, 'HumanitZ.exe'), 'exe')
  write(path.join(bin, 'HumanitZ-Win64-Shipping.exe'), 'exe')
  state.config = { gamePath: gameRoot, ue4ssVersion: 'experimental-latest', ue4ssPublishedAt: 'P1' }
  state.releaseZip = path.join(root, 'release.zip')
  state.pick = null
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  fs.rmSync(root, { recursive: true, force: true })
})

// A working experimental-layout UE4SS install with user settings.
function installExperimental() {
  write(path.join(bin, 'dwmapi.dll'), 'OLD-PROXY')
  write(path.join(bin, 'ue4ss', 'UE4SS.dll'), 'OLD-CORE')
  write(path.join(bin, 'ue4ss', 'UE4SS-settings.ini'), 'USER-SETTINGS')
  write(path.join(bin, 'ue4ss', 'UE4SS.log'), 'log')
  fs.mkdirSync(path.join(bin, 'ue4ss', 'Mods'), { recursive: true })
}

const releaseEntries = (extra = []) => [
  { name: 'dwmapi.dll', data: 'NEW-PROXY' },
  { name: 'ue4ss/UE4SS.dll', data: 'NEW-CORE' },
  { name: 'ue4ss/UE4SS-settings.ini', data: 'DEFAULT-SETTINGS' },
  ...extra,
]

describe('UE4SS deploy rollback (gid 52)', () => {
  it('rolls back a rotation that fails partway (locked UE4SS.log)', async () => {
    installExperimental()
    fs.writeFileSync(state.releaseZip, buildZip(releaseEntries()))
    const realRename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from).endsWith('UE4SS.log')) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      return realRename(from, to)
    })

    await expect(invoke('ue4ss:update')).rejects.toThrow(/EBUSY/)

    expect(read(path.join(bin, 'dwmapi.dll'))).toBe('OLD-PROXY')
    expect(read(path.join(bin, 'ue4ss', 'UE4SS.dll'))).toBe('OLD-CORE')
    expect(read(path.join(bin, 'ue4ss', 'UE4SS-settings.ini'))).toBe('USER-SETTINGS')
    expect((await invoke('ue4ss:status')).status).toBe('installed')
  })

  it('recovers files stranded in a leftover backup dir before wiping it', async () => {
    // What an earlier failed deploy left behind: UE4SS moved aside, not restored.
    const backupDir = path.join(bin, '_hzmm_ue4ss_backup')
    write(path.join(backupDir, 'dwmapi.dll'), 'OLD-PROXY')
    write(path.join(backupDir, 'ue4ss', 'UE4SS.dll'), 'OLD-CORE')
    write(path.join(backupDir, 'ue4ss', 'UE4SS-settings.ini'), 'USER-SETTINGS')
    fs.mkdirSync(path.join(bin, 'ue4ss', 'Mods'), { recursive: true })
    fs.writeFileSync(state.releaseZip, buildZip(releaseEntries()))

    await expect(invoke('ue4ss:install')).resolves.toEqual({ version: 'experimental-latest' })

    expect(read(path.join(bin, 'ue4ss', 'UE4SS-settings.ini'))).toBe('USER-SETTINGS')
    expect(read(path.join(bin, 'ue4ss', 'UE4SS.dll'))).toBe('NEW-CORE')
    expect(fs.existsSync(backupDir)).toBe(false)
  })
})

describe('UE4SS deploy keeps the user mod lists (gid 53)', () => {
  const USER_TXT = 'BPModLoaderMod : 1\nConsoleEnablerMod : 0\nMyHzmmMod : 1\n; Built-in keybinds, do not move up!\nKeybinds : 1\n'
  const RELEASE_TXT = 'BPModLoaderMod : 1\nConsoleEnablerMod : 1\nNewDefaultMod : 1\n; Built-in keybinds, do not move up!\nKeybinds : 1\n'
  const USER_JSON = JSON.stringify([
    { mod_name: 'BPModLoaderMod', mod_enabled: true },
    { mod_name: 'ConsoleEnablerMod', mod_enabled: false },
    { mod_name: 'MyHzmmMod', mod_enabled: true },
    { mod_name: 'Keybinds', mod_enabled: true },
  ], null, 4)
  const RELEASE_JSON = JSON.stringify([
    { mod_name: 'BPModLoaderMod', mod_enabled: true },
    { mod_name: 'ConsoleEnablerMod', mod_enabled: true },
    { mod_name: 'NewDefaultMod', mod_enabled: true },
    { mod_name: 'Keybinds', mod_enabled: true },
  ], null, 4)

  it('merges the release defaults into the user lists instead of replacing them', async () => {
    installExperimental()
    const modsDir = path.join(bin, 'ue4ss', 'Mods')
    write(path.join(modsDir, 'mods.txt'), USER_TXT)
    write(path.join(modsDir, 'mods.json'), USER_JSON)
    fs.writeFileSync(state.releaseZip, buildZip(releaseEntries([
      { name: 'ue4ss/Mods/mods.txt', data: RELEASE_TXT },
      { name: 'ue4ss/Mods/mods.json', data: RELEASE_JSON },
    ])))

    await invoke('ue4ss:update')

    const enabled = readUe4ssEnabledNames(modsDir)
    expect(enabled.has('MyHzmmMod')).toBe(true)
    expect(enabled.has('NewDefaultMod')).toBe(true)
    expect(enabled.has('ConsoleEnablerMod')).toBe(false)
    const txt = read(path.join(modsDir, 'mods.txt'))
    expect(txt).toContain('ConsoleEnablerMod : 0')
    // A newly shipped default goes above the keybinds comment.
    expect(txt.indexOf('NewDefaultMod : 1')).toBeLessThan(txt.indexOf('; Built-in keybinds'))
    const json = JSON.parse(read(path.join(modsDir, 'mods.json')))
    expect(json.map(m => m.mod_name)).toEqual(['BPModLoaderMod', 'ConsoleEnablerMod', 'MyHzmmMod', 'Keybinds', 'NewDefaultMod'])
    expect(json.find(m => m.mod_name === 'ConsoleEnablerMod').mod_enabled).toBe(false)
  })

  it('keeps CRLF line endings and appends when the user file has no keybinds comment', async () => {
    installExperimental()
    const modsTxt = path.join(bin, 'ue4ss', 'Mods', 'mods.txt')
    write(modsTxt, 'BPModLoaderMod : 1\r\nMyHzmmMod : 1\r\n')
    fs.writeFileSync(state.releaseZip, buildZip(releaseEntries([{ name: 'ue4ss/Mods/mods.txt', data: RELEASE_TXT }])))

    await invoke('ue4ss:update')

    expect(read(modsTxt)).toBe('BPModLoaderMod : 1\r\nMyHzmmMod : 1\r\nConsoleEnablerMod : 1\r\nNewDefaultMod : 1\r\nKeybinds : 1\r\n')
  })

  it('puts the user lists back verbatim when the extract fails partway', async () => {
    installExperimental()
    const modsTxt = path.join(bin, 'ue4ss', 'Mods', 'mods.txt')
    write(modsTxt, USER_TXT)
    fs.writeFileSync(state.releaseZip, buildZip([
      { name: 'ue4ss/Mods/mods.txt', data: RELEASE_TXT },
      { name: 'dwmapi.dll', data: 'NEW-PROXY', badCrc: true },
    ]))

    await expect(invoke('ue4ss:update')).rejects.toThrow()

    expect(read(modsTxt)).toBe(USER_TXT)
    expect(read(path.join(bin, 'dwmapi.dll'))).toBe('OLD-PROXY')
  })
})

describe('UE4SS install-from-file layout check (gid 55)', () => {
  it('refuses a zip whose files sit in a wrapper folder and leaves the install alone', async () => {
    installExperimental()
    state.pick = path.join(root, 'wrapped.zip')
    fs.writeFileSync(state.pick, buildZip([
      { name: 'UE4SS_v3/dwmapi.dll', data: 'NEW-PROXY' },
      { name: 'UE4SS_v3/ue4ss/UE4SS.dll', data: 'NEW-CORE' },
    ]))

    await expect(invoke('ue4ss:install-from-file')).rejects.toThrow('INVALID_UE4SS_ZIP')

    expect(read(path.join(bin, 'dwmapi.dll'))).toBe('OLD-PROXY')
    expect(read(path.join(bin, 'ue4ss', 'UE4SS.dll'))).toBe('OLD-CORE')
    expect(fs.existsSync(path.join(bin, 'UE4SS_v3'))).toBe(false)
  })

  it('refuses a zip with no proxy DLL at its root', async () => {
    installExperimental()
    state.pick = path.join(root, 'core-only.zip')
    fs.writeFileSync(state.pick, buildZip([{ name: 'ue4ss/UE4SS.dll', data: 'NEW-CORE' }]))

    await expect(invoke('ue4ss:install-from-file')).rejects.toThrow('INVALID_UE4SS_ZIP')
    expect(read(path.join(bin, 'dwmapi.dll'))).toBe('OLD-PROXY')
  })

  it('accepts the official experimental and flat 3.0.1 layouts', async () => {
    installExperimental()
    state.pick = path.join(root, 'experimental.zip')
    fs.writeFileSync(state.pick, buildZip(releaseEntries()))
    await expect(invoke('ue4ss:install-from-file')).resolves.toEqual({ version: 'manual' })
    expect(read(path.join(bin, 'ue4ss', 'UE4SS.dll'))).toBe('NEW-CORE')

    state.pick = path.join(root, 'flat.zip')
    fs.writeFileSync(state.pick, buildZip([
      { name: 'dwmapi.dll', data: 'FLAT-PROXY' },
      { name: 'UE4SS.dll', data: 'FLAT-CORE' },
      { name: 'Mods/mods.txt', data: 'Keybinds : 1\n' },
    ]))
    await expect(invoke('ue4ss:install-from-file')).resolves.toEqual({ version: 'manual' })
    expect(read(path.join(bin, 'UE4SS.dll'))).toBe('FLAT-CORE')
  })
})

describe('UE4SS status (gid 59)', () => {
  it('reports uninstalled when only a non-UE4SS proxy DLL is present', async () => {
    write(path.join(bin, 'd3d11.dll'), 'reshade')
    expect((await invoke('ue4ss:status')).status).toBe('uninstalled')
  })

  it('still detects both real layouts', async () => {
    write(path.join(bin, 'dwmapi.dll'), 'p')
    write(path.join(bin, 'ue4ss', 'UE4SS.dll'), 'c')
    expect(await invoke('ue4ss:status')).toMatchObject({ status: 'installed', structure: 'experimental' })

    fs.rmSync(path.join(bin, 'ue4ss'), { recursive: true })
    fs.rmSync(path.join(bin, 'dwmapi.dll'))
    write(path.join(bin, 'xinput1_3.dll'), 'p')
    write(path.join(bin, 'UE4SS.dll'), 'c')
    expect(await invoke('ue4ss:status')).toMatchObject({ status: 'installed', structure: 'legacy' })
  })
})

describe('getUe4ssModsPath (gid 54)', () => {
  it('returns Win64/Mods for the flat layout', () => {
    write(path.join(bin, 'UE4SS.dll'), 'c')
    fs.mkdirSync(path.join(bin, 'Mods'), { recursive: true })
    expect(getUe4ssModsPath(gameRoot)).toBe(path.join(bin, 'Mods'))
  })

  it('returns Win64/ue4ss/Mods for the experimental layout', () => {
    fs.mkdirSync(path.join(bin, 'ue4ss', 'Mods'), { recursive: true })
    fs.mkdirSync(path.join(bin, 'Mods'), { recursive: true })
    expect(getUe4ssModsPath(gameRoot)).toBe(path.join(bin, 'ue4ss', 'Mods'))
  })

  it('ignores a stale Win64/Mods with no UE4SS.dll next to it', () => {
    fs.mkdirSync(path.join(bin, 'Mods'), { recursive: true })
    expect(getUe4ssModsPath(gameRoot)).toBe(null)
  })
})

describe('game:set-path (gid 56)', () => {
  it('accepts the game root', async () => {
    state.config = {}
    expect(await invoke('game:set-path', gameRoot)).toEqual({ valid: true })
    expect(state.config.gamePath).toBe(gameRoot)
  })

  it('points a folder inside the game back at the root', async () => {
    state.config = {}
    for (const inside of [bin, path.join(gameRoot, 'HumanitZ'), path.join(gameRoot, 'HumanitZ', 'Content', 'Paks')]) {
      expect(await invoke('game:set-path', inside)).toEqual({ valid: false, reason: 'select-subfolder', suggestion: gameRoot })
    }
    expect(state.config.gamePath).toBeUndefined()
  })

  it('points steamapps/common at the HumanitZ folder inside it', async () => {
    expect(await invoke('game:set-path', path.dirname(gameRoot))).toEqual({ valid: false, reason: 'select-subfolder', suggestion: gameRoot })
  })

  it('rejects an unrelated folder that happens to hold an .exe', async () => {
    state.config = {}
    const downloads = path.join(root, 'Downloads')
    write(path.join(downloads, 'SteamSetup.exe'), 'exe')
    expect(await invoke('game:set-path', downloads)).toEqual({ valid: false, reason: 'not-game-folder' })
    expect(state.config.gamePath).toBeUndefined()
  })
})

describe('isGameRunning (gid 58)', () => {
  const RUNNING = '"HumanitZ-Win64-Shipping.exe","1234","Console","1","1,000 K"'
  const execPlan = (plan) => {
    state.exec = (_cmd, _opts, cb) => {
      const next = plan.shift()
      if (next instanceof Error) cb(next)
      else cb(null, { stdout: next, stderr: '' })
    }
  }

  it('rejects when tasklist fails instead of reporting "not running"', async () => {
    execPlan([new Error('Command failed: tasklist (timed out)')])
    await expect(isGameRunning()).rejects.toThrow(/tasklist/)
  })

  it('still reports false when tasklist ran and found nothing', async () => {
    execPlan(['INFO: No tasks are running which match the specified criteria.'])
    await expect(isGameRunning()).resolves.toBe(false)
  })

  it('a single failed poll does not push a running → stopped flap', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    execPlan([RUNNING, new Error('Command failed: tasklist (timed out)'), RUNNING])
    const sent = []
    const win = { isDestroyed: () => false, on: () => {}, webContents: { send: (ch, v) => sent.push([ch, v]) } }
    startGameRunningPolling(win)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(5000)
    vi.clearAllTimers()
    expect(sent).toEqual([['game:running', true]])
  })

  // A pending vanilla set must not stay disabled for good when tasklist never
  // works: after a whole grace period of failures the grace restore runs.
  describe('when tasklist keeps failing', () => {
    const paks = () => path.join(gameRoot, 'HumanitZ', 'Content', 'Paks')
    const startFailingPoller = (pendingAgeMs) => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
      write(path.join(paks(), 'a.pak.disabled'), 'pak')
      state.config.vanillaLaunchRestore = { entries: [{ type: 'PAK', filename: 'a.pak' }], at: Date.now() - pendingAgeMs }
      state.exec = (_cmd, _opts, cb) => cb(new Error('Command failed: tasklist (timed out)'))
      const sent = []
      const win = { isDestroyed: () => false, on: () => {}, webContents: { send: (ch, v) => sent.push([ch, v]) } }
      startGameRunningPolling(win)
      return sent
    }

    it('restores the pending vanilla set once the failures outlast the grace period', async () => {
      const sent = startFailingPoller(0)
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(125_000)
      vi.clearAllTimers()
      expect(sent).toEqual([['game:vanilla-restored', { restored: 1 }], ['mods:updated', undefined]])
      expect(fs.existsSync(path.join(paks(), 'a.pak'))).toBe(true)
      expect(state.config.vanillaLaunchRestore).toBe(null)
    })

    it('does not restore during a shorter run of failures, even for an old pending set', async () => {
      const sent = startFailingPoller(10 * 60_000)
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(60_000)
      vi.clearAllTimers()
      expect(sent).toEqual([])
      expect(fs.existsSync(path.join(paks(), 'a.pak.disabled'))).toBe(true)
    })
  })
})

// Fresh steam-detector per test: getSteamPath caches for the process lifetime.
async function freshSteamDetector() {
  vi.resetModules()
  return await import('../../src/main/services/steam-detector')
}

const regOutput = (key, value, data) => Buffer.concat([
  Buffer.from(`\r\n${key}\r\n    ${value}    REG_SZ    `, 'latin1'),
  Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1'),
  Buffer.from('\r\n\r\n', 'latin1'),
])

// reg: { 'KEY|Value': string | Buffer } — missing keys fail like reg.exe does.
function mockRegistry(reg, powershell = () => { throw new Error('powershell unavailable') }) {
  state.execFileSync = (file, args, opts) => {
    if (file === 'reg') {
      const [, key, , value] = args
      const data = reg[`${key}|${value}`]
      if (data == null) throw new Error('ERROR: The system was unable to find the specified registry key or value.')
      return regOutput(key, value, data)
    }
    if (file === 'powershell') return powershell(opts.env)
    throw new Error(`unexpected execFileSync ${file}`)
  }
}

function makeSteam(dir) {
  const game = path.join(dir, 'steamapps', 'common', 'HumanitZ')
  write(path.join(game, 'HumanitZ.exe'), 'exe')
  return game
}

const WOW = 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam'
const HKCU = 'HKCU\\SOFTWARE\\Valve\\Steam'

describe('getSteamPath registry probing (gid 63)', () => {
  it('skips a registry path that no longer exists and reads HKCU SteamPath', async () => {
    const steam = path.join(root, 'Steam')
    const game = makeSteam(steam)
    mockRegistry({ [`${WOW}|InstallPath`]: path.join(root, 'RemovedSteam'), [`${HKCU}|SteamPath`]: steam })
    const { detectGamePath } = await freshSteamDetector()
    expect(detectGamePath()).toBe(game)
  })

  it('re-reads a non-ASCII registry value as UTF-8 instead of the OEM code page bytes', async () => {
    const steam = path.join(root, '遊戲', 'Steam')
    const game = makeSteam(steam)
    // What reg.exe pipes on a zh-TW system: cp950 bytes, not UTF-8.
    const cp950 = Buffer.concat([Buffer.from(root + '/', 'latin1'), Buffer.from([0xb9, 0x43, 0xc0, 0xb8]), Buffer.from('/Steam', 'latin1')])
    const seen = []
    mockRegistry({ [`${WOW}|InstallPath`]: cp950 }, (env) => {
      seen.push([env.HZMM_REG_KEY, env.HZMM_REG_VALUE])
      return `${steam}\r\n`
    })
    const { detectGamePath } = await freshSteamDetector()
    expect(detectGamePath()).toBe(game)
    expect(seen).toEqual([['HKLM:\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath']])
  })

  // reg.exe on an English (cp437) system writes '?' for CJK characters: the
  // output is pure ASCII, but the path is not the real one.
  it('re-reads a value reg.exe turned into "?" (characters outside the OEM code page)', async () => {
    const steam = path.join(root, '游戏', 'Steam')
    const game = makeSteam(steam)
    const seen = []
    mockRegistry({ [`${WOW}|InstallPath`]: path.join(root, '??', 'Steam') }, (env) => {
      seen.push([env.HZMM_REG_KEY, env.HZMM_REG_VALUE])
      return `${steam}\r\n`
    })
    const { detectGamePath } = await freshSteamDetector()
    expect(detectGamePath()).toBe(game)
    expect(seen).toEqual([['HKLM:\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath']])
  })

  // A best-fit conversion gives an ASCII look-alike with no '?' (Ł -> L):
  // the folder it names does not exist, so the value is read again.
  it('re-reads an ASCII value whose folder does not exist (best-fit look-alike)', async () => {
    const steam = path.join(root, 'Łódź', 'Steam')
    const game = makeSteam(steam)
    let psCalls = 0
    mockRegistry({ [`${HKCU}|SteamPath`]: path.join(root, 'Lodz', 'Steam') }, () => { psCalls++; return steam })
    const { detectGamePath } = await freshSteamDetector()
    expect(detectGamePath()).toBe(game)
    expect(psCalls).toBe(1)
  })

  it('does not start PowerShell when the reg.exe value is ASCII and exists', async () => {
    const steam = path.join(root, 'Steam')
    const game = makeSteam(steam)
    let psCalls = 0
    mockRegistry({ [`${WOW}|InstallPath`]: steam }, () => { psCalls++; return '' })
    const { detectGamePath } = await freshSteamDetector()
    expect(detectGamePath()).toBe(game)
    expect(psCalls).toBe(0)
  })
})

describe('Steam News version fetch (gids 57, 60)', () => {
  const steamWithBuild = (buildId) => {
    const steam = path.join(root, 'Steam')
    makeSteam(steam)
    write(path.join(steam, 'steamapps', 'appmanifest_1766060.acf'), `"AppState"\n{\n\t"buildid"\t\t"${buildId}"\n\t"LastUpdated"\t\t"1700000000"\n}\n`)
    mockRegistry({ [`${WOW}|InstallPath`]: steam })
  }
  const failingNews = (req) => req.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
  const newsWith = (title) => (req) => {
    const res = new EventEmitter()
    res.statusCode = 200
    res.headers = {}
    req.emit('response', res)
    res.emit('data', Buffer.from(JSON.stringify({ appnews: { newsitems: [{ title }] } })))
    res.emit('end')
  }

  it('handles a response stream error without an uncaught exception', async () => {
    mockRegistry({})
    const uncaught = []
    state.netScript = (req) => {
      const res = new EventEmitter()
      res.statusCode = 200
      res.headers = {}
      req.emit('response', res)
      res.emit('data', Buffer.from('{"appnews":{"newsit'))
      const err = new Error('net::ERR_CONNECTION_RESET')
      // An 'error' with no listener throws: in Electron that is an uncaught
      // exception in the main process.
      try { res.emit('error', err) } catch (e) { uncaught.push(e.message) }
      req.emit('error', err)
    }
    const { getGameVersion } = await freshSteamDetector()
    const started = Date.now()
    await expect(getGameVersion(path.join(root, 'no-such-game'))).resolves.toBe(null)
    expect(uncaught).toEqual([])
    expect(Date.now() - started).toBeLessThan(2500)
  })

  it('keeps the cached version name of the same build when the fetch fails', async () => {
    steamWithBuild('123')
    state.config.cachedGameVersion = { versionName: '1.02.A', buildId: '123', lastUpdated: 'x' }
    state.netScript = failingNews
    const { getGameVersion } = await freshSteamDetector()
    const result = await getGameVersion(gameRoot)
    expect(result).toMatchObject({ versionName: '1.02.A', buildId: '123' })
    expect(state.config.cachedGameVersion).toMatchObject({ versionName: '1.02.A', buildId: '123' })
  })

  it('drops the cached name for a different build, and a successful fetch overwrites it', async () => {
    steamWithBuild('124')
    state.config.cachedGameVersion = { versionName: '1.02.A', buildId: '123', lastUpdated: 'x' }
    state.netScript = failingNews
    let detector = await freshSteamDetector()
    expect(await detector.getGameVersion(gameRoot)).toMatchObject({ versionName: null, buildId: '124' })

    state.netScript = newsWith('HumanitZ 1.03.B Update')
    detector = await freshSteamDetector()
    expect(await detector.getGameVersion(gameRoot)).toMatchObject({ versionName: '1.03.B', buildId: '124' })
  })
})

describe('saves:restore-backup (gid 61)', () => {
  let saveDir, backupPath
  const FILES = ['Save_W.sav', 'W_CharPreview.sav', 'W_Foliage.sav']

  beforeEach(() => {
    vi.stubEnv('LOCALAPPDATA', path.join(root, 'LocalAppData'))
    saveDir = path.join(root, 'LocalAppData', 'HumanitZ', 'Saved', 'SaveGames', 'SaveList', 'Default')
    backupPath = path.join(state.cfgDir, 'backups', 'save_backup_2026-01-01T00-00-00')
    for (const f of FILES) {
      write(path.join(saveDir, f), `OLD-${f}`)
      write(path.join(backupPath, 'worlds', 'W', f), `NEW-${f}`)
    }
  })
  afterEach(() => { vi.unstubAllEnvs() })

  const leftovers = () => fs.readdirSync(saveDir).filter(f => !f.endsWith('.sav'))

  it('restores every file of the backup', async () => {
    expect(await invoke('saves:restore-backup', backupPath)).toMatchObject({ restored: true, worlds: ['W'] })
    for (const f of FILES) expect(read(path.join(saveDir, f))).toBe(`NEW-${f}`)
    expect(leftovers()).toEqual([])
  })

  it('leaves every live save as it was when one file cannot be replaced', () => {
    const realRename = fs.renameSync
    let placed = 0
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (path.dirname(String(to)) === saveDir && String(to).endsWith('.sav') && ++placed === 2) {
        throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' })
      }
      return realRename(from, to)
    })

    expect(() => invoke('saves:restore-backup', backupPath)).toThrow(/EPERM/)

    for (const f of FILES) expect(read(path.join(saveDir, f))).toBe(`OLD-${f}`)
    expect(leftovers()).toEqual([])
  })
})
