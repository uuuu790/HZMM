import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Regression tests for the Nexus cluster: rollback on multi-variant pages and
// its receipt rewrite, nexus:validate classification + per-key cache, the
// profile fallback receipt, UE4SS registry-aware update state, same-file
// reinstall snapshots, link-mod on multi-variant pages, the stale-successor
// sweep for fileId:null receipts, and install-mod's receipt-write guard.
// Real nexus.ts / mods-download / update flow / mod-versions over temp dirs;
// only Electron, config, the V1 HTTP client, V2 file lists, the download and
// the archive installer are faked.

const state = vi.hoisted(() => ({
  handlers: new Map(),
  config: {},
  configDir: null,
  paksPaths: [],
  ue4ssModsPath: null,
  setThrows: null,
  netRequest: null,
  netCalls: [],
  modFiles: {},
  v1Files: {},
  delisted: new Set(),
  packages: {},
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel, fn) => state.handlers.set(channel, fn) },
  app: { getVersion: () => '0.0.0-test', getPath: () => '' },
  shell: {},
  net: {},
}))
vi.mock('../../src/main/services/logger', () => ({
  default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))
vi.mock('../../src/main/services/config-store', () => ({
  default: {
    get: (key, def = null) => (key in state.config ? state.config[key] : def),
    // Like the real store: the cache is updated, then the save may throw.
    set: (key, value) => {
      state.config[key] = value
      if (state.setThrows === key) {
        throw Object.assign(new Error("EPERM: operation not permitted, rename 'config.json.tmp' -> 'config.json'"), { code: 'EPERM' })
      }
    },
    remove: (key) => { delete state.config[key] },
    getConfigDir: () => state.configDir,
  },
}))
vi.mock('../../src/main/services/steam-detector', () => ({
  getAllPaksPaths: () => state.paksPaths,
  getUe4ssModsPath: () => state.ue4ssModsPath,
  getPaksPath: () => state.paksPaths[0],
}))
vi.mock('../../src/main/services/net-client', () => ({
  netRequest: (...args) => state.netRequest(...args),
}))
vi.mock('../../src/main/ipc/nexus-v2-client', async (importOriginal) => ({
  ...(await importOriginal()),
  v2GetModFiles: async (modId) => state.modFiles[modId] || [],
}))
vi.mock('../../src/main/ipc/mods-scan', async (importOriginal) => ({
  ...(await importOriginal()),
  scanMods: () => [],
  wasLastScanPartial: () => false,
  invalidateCache: () => {},
}))
vi.mock('../../src/main/services/archive', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadFile: async (_url, dest) => { fs.writeFileSync(dest, 'archive') },
}))
// The fake installer lands the pak registered for the downloaded file (the
// temp file is named f<fileId>.zip by the fake CDN below).
vi.mock('../../src/main/ipc/mods-install', async (importOriginal) => ({
  ...(await importOriginal()),
  installMods: async ([tempPath]) => {
    const fileId = Number(path.basename(tempPath).match(/^f(\d+)\.zip$/)[1])
    const pkg = state.packages[fileId]
    fs.writeFileSync(path.join(state.paksPaths[0], `${pkg.name}_P.pak`), pkg.content)
    return [{ mods: [{ name: pkg.name, modType: 'PAK' }] }]
  },
}))

import { registerNexusIpc } from '../../src/main/ipc/nexus'
import { nexusApiRequest } from '../../src/main/ipc/mods-download'
import { runUpdateWithStateRestore } from '../../src/main/ipc/mods-update-flow'
import { captureModState, restoreModState } from '../../src/main/ipc/mods-update-state'
import { mergeLinkIntoReceipts } from '../../src/main/ipc/nexus-install-tracker'
import { checkUpdates, evaluateOutdated } from '../../src/main/ipc/nexus-update-checker'
import { syncUe4ssModRegistry } from '../../src/main/ipc/mods-registry'
import { listModVersions } from '../../src/main/ipc/mod-versions'

const mainWindow = { isDestroyed: () => false, webContents: { send: () => {} } }
const invoke = (channel, ...args) => state.handlers.get(channel)({}, ...args)

const json = (body, statusCode = 200) => ({ statusCode, headers: {}, bodyText: JSON.stringify(body) })

// Fake Nexus V1 API. validate answers per API key via state.validate.
function v1Router(url, opts) {
  state.netCalls.push(url)
  const p = url.replace(/^https:\/\/api\.nexusmods\.com\/v1/, '').split('?')[0]
  if (p === '/users/validate.json') return state.validate(opts.headers.apikey)
  let m = p.match(/\/mods\/(\d+)\/files\.json$/)
  if (m) return json({ files: state.v1Files[m[1]] || [] })
  m = p.match(/\/mods\/(\d+)\/files\/(\d+)\/download_link\.json$/)
  if (m) {
    if (state.delisted.has(Number(m[2]))) return json({ message: 'not found' }, 404)
    return json([{ URI: `https://cf-files.nexusmods.com/f${m[2]}.zip`, name: 'CF' }])
  }
  m = p.match(/\/mods\/(\d+)\/files\/(\d+)\.json$/)
  if (m) return state.delisted.has(Number(m[2])) ? json({}, 404) : json({ file_name: `f${m[2]}.zip` })
  return json({}, 404)
}

const v2File = (file_id, name, version, date) => ({ file_id, name, version, category_id: 1, category_name: 'MAIN', uploaded_timestamp: date })

let root, paks, ue4ss

beforeAll(() => {
  registerNexusIpc(mainWindow)
})

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-bugfix-c-nexus-'))
  paks = path.join(root, 'Paks')
  ue4ss = path.join(root, 'Mods')
  for (const d of [paks, ue4ss]) fs.mkdirSync(d, { recursive: true })
  state.configDir = path.join(root, 'config')
  fs.mkdirSync(state.configDir, { recursive: true })
  state.paksPaths = [paks]
  state.ue4ssModsPath = ue4ss
  state.config = { gamePath: root, nexusApiKey: 'key-a' }
  state.setThrows = null
  state.netCalls = []
  state.netRequest = async (url, opts) => v1Router(url, opts)
  state.modFiles = {}
  state.v1Files = {}
  state.delisted = new Set()
  state.packages = {}
  state.validate = () => json({ is_premium: true, name: 'user' })
  invoke('nexus:clear-cache')
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const receipts = () => state.config.nexusInstalledMods || []
const brief = () => receipts().map(r => ({ fileId: r.fileId, version: r.version ?? null, names: (r.localMods || []).map(lm => lm.name) }))

describe('nexus:validate (gids 33, 103, 38)', () => {
  it('reports 401/403 as an invalid key and other failures as network', async () => {
    state.validate = () => json({ message: 'nope' }, 401)
    expect(await invoke('nexus:validate')).toMatchObject({ ok: false, reason: 'invalid', error: 'Invalid Nexus Mods API key' })
    state.validate = () => json({ message: 'nope' }, 403)
    expect(await invoke('nexus:validate')).toMatchObject({ ok: false, reason: 'invalid' })
    state.validate = () => json({}, 500)
    expect(await invoke('nexus:validate')).toMatchObject({ ok: false, reason: 'network', error: 'Nexus API error: HTTP 500' })
  })

  it('nexusApiRequest keeps its messages and attaches the HTTP status', async () => {
    state.validate = () => json({}, 401)
    await expect(nexusApiRequest('/users/validate.json', 'k')).rejects.toMatchObject({ message: 'Invalid Nexus Mods API key', statusCode: 401 })
  })

  it('does not reuse a cached verdict after the API key changes', async () => {
    state.validate = (key) => json(key === 'key-a' ? { is_premium: false, name: 'free' } : { is_premium: true, name: 'premium' })
    expect(await invoke('nexus:validate')).toMatchObject({ ok: false, reason: 'not-premium', name: 'free' })
    state.config.nexusApiKey = 'key-b'
    expect(await invoke('nexus:validate')).toMatchObject({ ok: true, name: 'premium' })
    // Same key again: still served from cache.
    expect(await invoke('nexus:validate')).toMatchObject({ ok: true, name: 'premium' })
    expect(state.netCalls.filter(u => u.includes('/users/validate.json'))).toHaveLength(2)
  })
})

describe('nexus:install-mod receipt write (gid 41)', () => {
  it('resolves with the install result when the receipt save throws after files landed', async () => {
    state.v1Files[5] = [{ file_id: 31, category_id: 1, uploaded_timestamp: 100, file_name: 'f31.zip' }]
    state.packages[31] = { name: 'BeastOfBurden', content: 'bob v1.1' }
    state.setThrows = 'nexusInstalledMods'
    const result = await invoke('nexus:install-mod', 5)
    expect(result).toEqual([{ mods: [{ name: 'BeastOfBurden', modType: 'PAK' }] }])
    expect(fs.existsSync(path.join(paks, 'BeastOfBurden_P.pak'))).toBe(true)
  })
})

describe('nexus:install-file fallbackToLatest (gid 34)', () => {
  it('records the file that actually landed, so later uploads are flagged', async () => {
    state.delisted.add(99)
    state.v1Files[5] = [
      { file_id: 30, category_id: 1, uploaded_timestamp: 100, file_name: 'f30.zip', version: '1.0' },
      { file_id: 31, category_id: 1, uploaded_timestamp: 200, file_name: 'f31.zip', version: '1.1' },
    ]
    state.packages[31] = { name: 'BeastOfBurden', content: 'bob v1.1' }
    const res = await invoke('nexus:install-file', 5, 99, '0.9', true)
    expect(res.fellBackToLatest).toBe(true)
    expect(brief()).toEqual([{ fileId: 31, version: '1.1', names: ['BeastOfBurden'] }])

    state.modFiles[5] = [
      v2File(30, 'Beast of Burden', '1.0', '2024-01-01T00:00:00Z'),
      v2File(31, 'Beast of Burden', '1.1', '2024-02-01T00:00:00Z'),
      v2File(32, 'Beast of Burden', '1.2', '2024-03-01T00:00:00Z'),
    ]
    const { results } = await checkUpdates(true)
    expect(results).toEqual([expect.objectContaining({ outdated: true, latestFileId: 32, currentVersion: '1.1' })])
  })

  it('still records the pinned file and version when no fallback happened', async () => {
    state.packages[30] = { name: 'BeastOfBurden', content: 'bob v1.0' }
    await invoke('nexus:install-file', 5, 30, '1.0', true)
    expect(brief()).toEqual([{ fileId: 30, version: '1.0', names: ['BeastOfBurden'] }])
  })
})

// Mod 5 hosts two variants: Backpack50 (file 10) and Beast of Burden (30 -> 31).
async function installTwoVariantsAndUpdate() {
  state.modFiles[5] = [
    v2File(10, 'Backpack50', '1.0', '2024-01-01T00:00:00Z'),
    v2File(30, 'Beast of Burden', '1.0', '2024-02-01T00:00:00Z'),
    v2File(31, 'Beast of Burden', '1.1', '2024-03-01T00:00:00Z'),
  ]
  state.packages[10] = { name: 'Backpack50', content: 'bp v1.0' }
  state.packages[30] = { name: 'BeastOfBurden', content: 'bob v1.0' }
  state.packages[31] = { name: 'BeastOfBurden', content: 'bob v1.1' }
  await invoke('nexus:install-file', 5, 10, '1.0')
  await invoke('nexus:install-file', 5, 30, '1.0')
  await invoke('nexus:update-file', 5, 31, '1.1')
}

const retention = () => path.join(state.configDir, 'mod-versions')

describe('nexus:rollback-mod (gids 31, 32)', () => {
  it('rolls back only the snapshot variant and retires the newer receipt', async () => {
    await installTwoVariantsAndUpdate()
    expect(brief()).toEqual([
      { fileId: 10, version: '1.0', names: ['Backpack50'] },
      { fileId: 31, version: '1.1', names: ['BeastOfBurden'] },
    ])
    const snaps = (await invoke('nexus:list-mod-versions'))['5']
    expect(snaps.map(s => [s.fileId, s.version])).toEqual([[30, '1.0']])

    const res = await invoke('nexus:rollback-mod', 5, snaps[0].dir)
    expect(res).toEqual({ ok: true, version: '1.0' })
    // The sibling variant's pak survives; the rolled-back one is the old version.
    expect(fs.readFileSync(path.join(paks, 'Backpack50_P.pak'), 'utf-8')).toBe('bp v1.0')
    expect(fs.readFileSync(path.join(paks, 'BeastOfBurden_P.pak'), 'utf-8')).toBe('bob v1.0')
    expect(brief()).toEqual([
      { fileId: 10, version: '1.0', names: ['Backpack50'] },
      { fileId: 30, version: '1.0', names: ['BeastOfBurden'] },
    ])

    // The forced re-check after rollback brings the update badge back.
    const { results } = await checkUpdates(true)
    expect(results.map(r => [r.outdated, r.latestFileId])).toEqual([[false, 10], [true, 31]])
    expect(brief().map(r => r.fileId)).toEqual([10, 30])
  })

  it('a single-variant rollback leaves one receipt for the restored file', async () => {
    state.modFiles[5] = [
      v2File(30, 'Beast of Burden', '1.0', '2024-02-01T00:00:00Z'),
      v2File(31, 'Beast of Burden', '1.1', '2024-03-01T00:00:00Z'),
    ]
    state.packages[30] = { name: 'BeastOfBurden', content: 'bob v1.0' }
    state.packages[31] = { name: 'BeastOfBurden', content: 'bob v1.1' }
    await invoke('nexus:install-file', 5, 30, '1.0')
    await invoke('nexus:update-file', 5, 31, '1.1')
    const snaps = (await invoke('nexus:list-mod-versions'))['5']
    await invoke('nexus:rollback-mod', 5, snaps[0].dir)
    expect(brief()).toEqual([{ fileId: 30, version: '1.0', names: ['BeastOfBurden'] }])
    expect(fs.readFileSync(path.join(paks, 'BeastOfBurden_P.pak'), 'utf-8')).toBe('bob v1.0')
  })
})

describe('nexus:rollback-mod pre-clear and receipts (review follow-up)', () => {
  const snapshotDir = async () => (await invoke('nexus:list-mod-versions'))['5'][0].dir
  const pakContent = (name) => fs.readFileSync(path.join(paks, name), 'utf-8')

  // Single-variant page whose 1.1 upload renamed the pak: 30 lands
  // BeastOfBurden, 31 lands BeastOfBurdenV2 (the update carries the old name
  // onto receipt 31).
  async function installAndUpdateRenamed({ withSibling = false } = {}) {
    state.modFiles[5] = [
      ...(withSibling ? [v2File(10, 'Backpack50', '1.0', '2024-01-01T00:00:00Z')] : []),
      v2File(30, 'Beast of Burden', '1.0', '2024-02-01T00:00:00Z'),
      v2File(31, 'Beast of Burden', '1.1', '2024-03-01T00:00:00Z'),
    ]
    state.packages[10] = { name: 'Backpack50', content: 'bp v1.0' }
    state.packages[30] = { name: 'BeastOfBurden', content: 'bob v1.0' }
    state.packages[31] = { name: 'BeastOfBurdenV2', content: 'bob v1.1' }
    if (withSibling) await invoke('nexus:install-file', 5, 10, '1.0')
    await invoke('nexus:install-file', 5, 30, '1.0')
    await invoke('nexus:update-file', 5, 31, '1.1')
    expect(brief().at(-1)).toEqual({ fileId: 31, version: '1.1', names: ['BeastOfBurdenV2', 'BeastOfBurden'] })
  }

  it('a restore that fails its up-front check deletes nothing', async () => {
    await installTwoVariantsAndUpdate()
    const dir = await snapshotDir()
    // The snapshot's pak is gone (cleaned up, AV-quarantined).
    for (const f of fs.readdirSync(path.join(dir, 'paks'))) fs.rmSync(path.join(dir, 'paks', f))
    await expect(invoke('nexus:rollback-mod', 5, dir)).rejects.toThrow(/Snapshot is incomplete/)
    expect(pakContent('BeastOfBurden_P.pak')).toBe('bob v1.1')
    expect(pakContent('Backpack50_P.pak')).toBe('bp v1.0')
    expect(brief().map(r => r.fileId)).toEqual([10, 31])
    expect(fs.existsSync(dir)).toBe(true)
  })

  it('a copy that fails mid-restore puts every cleared file back', async () => {
    await installAndUpdateRenamed()
    const dir = await snapshotDir()
    // Present but uncopyable: fails only after the current files went aside.
    const snapPak = path.join(dir, 'paks', 'BeastOfBurden_P.pak')
    fs.rmSync(snapPak)
    fs.mkdirSync(snapPak)
    await expect(invoke('nexus:rollback-mod', 5, dir)).rejects.toThrow()
    expect(fs.readdirSync(paks).sort()).toEqual(['BeastOfBurdenV2_P.pak', 'BeastOfBurden_P.pak'])
    expect(pakContent('BeastOfBurdenV2_P.pak')).toBe('bob v1.1')
    expect(brief().map(r => r.fileId)).toEqual([31])
  })

  it('removes the pak the newer version renamed to, and stops tracking it', async () => {
    await installAndUpdateRenamed()
    await invoke('nexus:rollback-mod', 5, await snapshotDir())
    expect(fs.readdirSync(paks)).toEqual(['BeastOfBurden_P.pak'])
    expect(pakContent('BeastOfBurden_P.pak')).toBe('bob v1.0')
    expect(brief()).toEqual([{ fileId: 30, version: '1.0', names: ['BeastOfBurden'] }])
    const { results } = await checkUpdates(true)
    expect(results.map(r => [r.outdated, r.latestFileId])).toEqual([[true, 31]])
  })

  it('removes a renamed pak on a multi-variant page and leaves the sibling alone', async () => {
    await installAndUpdateRenamed({ withSibling: true })
    await invoke('nexus:rollback-mod', 5, await snapshotDir())
    expect(fs.readdirSync(paks).sort()).toEqual(['Backpack50_P.pak', 'BeastOfBurden_P.pak'])
    expect(pakContent('Backpack50_P.pak')).toBe('bp v1.0')
    expect(brief()).toEqual([
      { fileId: 10, version: '1.0', names: ['Backpack50'] },
      { fileId: 30, version: '1.0', names: ['BeastOfBurden'] },
    ])
  })

  it('never clears a pak a sibling receipt also tracks', async () => {
    await installTwoVariantsAndUpdate()
    // Receipt 31 also claims the sibling's pak (e.g. a link carried over).
    state.config.nexusInstalledMods[1].localMods.push({ modType: 'PAK', name: 'Backpack50' })
    await invoke('nexus:rollback-mod', 5, await snapshotDir())
    expect(pakContent('Backpack50_P.pak')).toBe('bp v1.0')
    expect(pakContent('BeastOfBurden_P.pak')).toBe('bob v1.0')
  })

  it('a rolled-back quick install (fileId:null) is flagged outdated again', async () => {
    state.v1Files[5] = [{ file_id: 30, category_id: 1, uploaded_timestamp: 100, file_name: 'f30.zip', version: '1.0' }]
    state.packages[30] = { name: 'BeastOfBurden', content: 'bob v1.0' }
    state.packages[31] = { name: 'BeastOfBurden', content: 'bob v1.1' }
    await invoke('nexus:install-mod', 5)
    state.config.nexusInstalledMods[0].installedAt = Date.parse('2024-02-15T00:00:00Z')
    state.modFiles[5] = [
      v2File(30, 'Beast of Burden', '1.0', '2024-02-01T00:00:00Z'),
      v2File(31, 'Beast of Burden', '1.1', '2024-03-01T00:00:00Z'),
    ]
    await invoke('nexus:update-file', 5, 31, '1.1')
    const dir = await snapshotDir()
    expect(listModVersions(retention())['5'].map(s => s.fileId)).toEqual([null])

    await invoke('nexus:rollback-mod', 5, dir)
    expect(pakContent('BeastOfBurden_P.pak')).toBe('bob v1.0')
    expect(receipts()).toEqual([expect.objectContaining({ fileId: null, installedAt: 0, localMods: [{ modType: 'PAK', name: 'BeastOfBurden' }] })])
    const { results } = await checkUpdates(true)
    expect(results.map(r => [r.outdated, r.latestFileId])).toEqual([[true, 31]])
  })
})

describe('same-file reinstall through the update flow (gid 37)', () => {
  it('keeps the existing snapshots and is not reported as an update', async () => {
    await installTwoVariantsAndUpdate()
    const before = listModVersions(retention())['5'].map(s => [s.fileId, s.version])
    expect(before).toEqual([[30, '1.0']])

    const { wasUpdate } = await runUpdateWithStateRestore(5, 31, async () => {
      fs.writeFileSync(path.join(paks, 'BeastOfBurden_P.pak'), 'bob v1.1')
      return []
    })
    expect(wasUpdate).toBe(false)
    expect(listModVersions(retention())['5'].map(s => [s.fileId, s.version])).toEqual(before)
  })

  it('still restores user state on a same-file reinstall', async () => {
    await installTwoVariantsAndUpdate()
    fs.renameSync(path.join(paks, 'BeastOfBurden_P.pak'), path.join(paks, 'BeastOfBurden_P.pak.disabled'))
    const { restored } = await runUpdateWithStateRestore(5, 31, async () => {
      fs.rmSync(path.join(paks, 'BeastOfBurden_P.pak.disabled'))
      fs.writeFileSync(path.join(paks, 'BeastOfBurden_P.pak'), 'bob v1.1')
      return []
    })
    expect(restored.enabledRestored).toBe(1)
    expect(fs.existsSync(path.join(paks, 'BeastOfBurden_P.pak.disabled'))).toBe(true)
  })
})

describe('UE4SS update state honours mods.txt / mods.json (gid 36)', () => {
  const P = () => ({ paksPaths: [paks], ue4ssModsPath: ue4ss })
  const modsTxt = () => fs.readFileSync(path.join(ue4ss, 'mods.txt'), 'utf-8')
  const modsJson = () => JSON.parse(fs.readFileSync(path.join(ue4ss, 'mods.json'), 'utf-8'))
  // What the installer does: rotate the folder away, land the new one, register `: 1`.
  function reinstall({ shipsEnabledTxt }) {
    fs.rmSync(path.join(ue4ss, 'CoolLua'), { recursive: true, force: true })
    fs.mkdirSync(path.join(ue4ss, 'CoolLua', 'Scripts'), { recursive: true })
    fs.writeFileSync(path.join(ue4ss, 'CoolLua', 'Scripts', 'main.lua'), 'new')
    if (shipsEnabledTxt) fs.writeFileSync(path.join(ue4ss, 'CoolLua', 'enabled.txt'), '')
    syncUe4ssModRegistry(ue4ss, 'CoolLua', true)
  }

  it('keeps a mod the user toggled off disabled after an update', () => {
    fs.mkdirSync(path.join(ue4ss, 'CoolLua', 'Scripts'), { recursive: true })
    fs.writeFileSync(path.join(ue4ss, 'mods.txt'), 'CoolLua : 0\n; Built-in keybinds, do not move up!\nKeybinds : 1\n')
    fs.writeFileSync(path.join(ue4ss, 'mods.json'), JSON.stringify([{ mod_name: 'CoolLua', mod_enabled: false }]))
    const captured = captureModState(P(), [{ name: 'CoolLua', modType: 'UE4SS' }])
    expect(captured[0].enabled).toBe(false)

    reinstall({ shipsEnabledTxt: false })
    expect(modsTxt()).toContain('CoolLua : 1')

    const summary = restoreModState(P(), captured)
    expect(summary.enabledRestored).toBe(1)
    expect(modsTxt()).toContain('CoolLua : 0')
    expect(modsJson()).toEqual([{ mod_name: 'CoolLua', mod_enabled: false }])
    expect(fs.existsSync(path.join(ue4ss, 'CoolLua', 'enabled.txt'))).toBe(false)
  })

  it('keeps a mod enabled only through mods.txt enabled after an update', () => {
    fs.mkdirSync(path.join(ue4ss, 'CoolLua', 'Scripts'), { recursive: true })
    fs.writeFileSync(path.join(ue4ss, 'mods.txt'), 'CoolLua : 1\n')
    const captured = captureModState(P(), [{ name: 'CoolLua', modType: 'UE4SS' }])
    expect(captured[0].enabled).toBe(true)

    reinstall({ shipsEnabledTxt: true })
    const summary = restoreModState(P(), captured)
    expect(summary.enabledRestored).toBe(0)
    expect(modsTxt()).toContain('CoolLua : 1')
    expect(fs.existsSync(path.join(ue4ss, 'CoolLua', 'enabled.txt'))).toBe(true)
  })
})

describe('mergeLinkIntoReceipts on multi-variant pages (gid 39)', () => {
  const A = { modId: 5, fileId: 10, installedAt: 1, version: '1.0', localMods: [{ modType: 'PAK', name: 'Backpack50' }] }
  const B = { modType: 'PAK', name: 'BeastOfBurden' }

  it("keeps the chosen fileId in its own receipt instead of joining a sibling's", () => {
    const out = mergeLinkIntoReceipts([A], 5, B, { fileId: 30, version: '1.0', now: 5 })
    expect(out).toEqual([A, { modId: 5, fileId: 30, installedAt: 5, version: '1.0', localMods: [B] }])
    const files = [
      v2File(10, 'Backpack50', '1.0', '2024-01-01T00:00:00Z'),
      v2File(30, 'Beast of Burden', '1.0', '2024-02-01T00:00:00Z'),
      v2File(31, 'Beast of Burden', '1.1', '2024-03-01T00:00:00Z'),
    ]
    expect(evaluateOutdated(out[1], files)).toMatchObject({ outdated: true, latestFileId: 31 })
    expect(evaluateOutdated(out[0], files).outdated).toBe(false)
  })

  it('joins the receipt for the same file, and never a fileId:null receipt tracking other files', () => {
    const same = { modId: 5, fileId: 30, installedAt: 1, version: '1.0', localMods: [{ modType: 'PAK', name: 'BeastExtra' }] }
    const merged = mergeLinkIntoReceipts([A, same], 5, B, { fileId: 30 })
    expect(merged).toHaveLength(2)
    expect(merged[1].localMods.map(lm => lm.name)).toEqual(['BeastExtra', 'BeastOfBurden'])

    const nullOther = { modId: 5, fileId: null, installedAt: 1, version: null, localMods: [{ modType: 'PAK', name: 'Backpack50' }] }
    const out = mergeLinkIntoReceipts([nullOther], 5, B, { fileId: 30, now: 7 })
    expect(out).toEqual([nullOther, { modId: 5, fileId: 30, installedAt: 7, version: null, localMods: [B] }])
  })
})

describe('stale-successor sweep with fileId:null receipts (gid 40)', () => {
  const installedAt = Date.parse('2024-02-01T00:00:00Z')
  const nullA = { modId: 5, fileId: null, installedAt, version: null, localMods: [{ modType: 'PAK', name: 'Backpack50' }] }
  const concreteB = { modId: 5, fileId: 20, installedAt, version: '1.0', localMods: [{ modType: 'PAK', name: 'BeastOfBurden' }] }

  it("does not fold a null receipt into a different variant's receipt", async () => {
    state.config.nexusInstalledMods = [nullA, concreteB]
    state.modFiles[5] = [
      v2File(10, 'Backpack50', '1.0', '2024-01-01T00:00:00Z'),
      v2File(20, 'Beast of Burden', '1.0', '2024-03-01T00:00:00Z'),
    ]
    let { results } = await checkUpdates(true)
    expect(receipts()).toEqual([nullA, concreteB])
    expect(results.map(r => [r.outdated, r.latestFileId])).toEqual([[false, 10], [false, 20]])

    // Backpack50's own update is still detected.
    state.modFiles[5].push(v2File(11, 'Backpack50', '1.1', '2024-04-01T00:00:00Z'))
    ;({ results } = await checkUpdates(true))
    expect(results.map(r => [r.outdated, r.latestFileId])).toEqual([[true, 11], [false, 20]])
    expect(receipts()).toHaveLength(2)
  })

  it('still retires a null receipt whose files the successor tracks', async () => {
    const nullB = { ...nullA, localMods: [{ modType: 'PAK', name: 'BeastOfBurden' }] }
    state.config.nexusInstalledMods = [nullB, concreteB]
    state.modFiles[5] = [v2File(20, 'Beast of Burden', '1.0', '2024-03-01T00:00:00Z')]
    await checkUpdates(true)
    expect(brief()).toEqual([{ fileId: 20, version: '1.0', names: ['BeastOfBurden'] }])
  })
})
