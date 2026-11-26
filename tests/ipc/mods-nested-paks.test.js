import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { path7za } from '7zip-bin'

// Nexus report (mods/82, 2026-11-26): paks inside a subfolder of Content/Paks
// (e.g. Paks/mods/) load in game — UE4 walks Paks recursively — but HZMM only
// looked at ~mods and the Paks root, so those mods were missing from the
// Library and out of reach of toggle / remove / conflicts / vanilla launch.

// In-memory config store: the scan and install code read gamePath and the
// config dir from it, so the tests never touch the developer's real config.
const store = vi.hoisted(() => ({ data: {}, dir: '' }))
vi.mock('../../src/main/services/config-store', () => ({
  default: {
    get: (k, d = null) => (Object.hasOwn(store.data, k) ? store.data[k] : d),
    set: (k, v) => { store.data[k] = v },
    remove: (k) => { delete store.data[k] },
    getConfigDir: () => store.dir,
  },
}))

// Capture ipcMain handlers so toggle / remove run through their real code.
const handlers = vi.hoisted(() => new Map())
vi.mock('electron', () => ({
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
  app: { isPackaged: false, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
  net: {},
  shell: {},
}))

const { getAllPaksPaths } = await import('../../src/main/services/steam-detector')
const { scanMods, invalidateCache } = await import('../../src/main/ipc/mods-scan')
const { installMods } = await import('../../src/main/ipc/mods-install')
const { registerModsIpc } = await import('../../src/main/ipc/mods')
const { disableModsOnDisk } = await import('../../src/main/ipc/game')
const { findConflicts } = await import('../../src/main/ipc/conflicts')

registerModsIpc(null)

let root, game, paks

function touch(rel, content = 'PAK') {
  const full = path.join(paks, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
  return full
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-nested-paks-'))
  game = path.join(root, 'HumanitZ')
  paks = path.join(game, 'HumanitZ', 'Content', 'Paks')
  fs.mkdirSync(path.join(paks, '~mods'), { recursive: true })
  fs.writeFileSync(path.join(paks, 'pakchunk0-WindowsNoEditor.pak'), 'BASE')
  store.dir = path.join(root, 'config')
  fs.mkdirSync(store.dir, { recursive: true })
  store.data = { gamePath: game }
  invalidateCache()
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('getAllPaksPaths', () => {
  it('lists ~mods first, then the Paks root, then every subfolder', () => {
    fs.mkdirSync(path.join(paks, 'mods'))
    fs.mkdirSync(path.join(paks, 'LogicMods'))
    expect(getAllPaksPaths(game)).toEqual([
      path.join(paks, '~mods'),
      paks,
      path.join(paks, 'LogicMods'),
      path.join(paks, 'mods'),
    ])
  })

  it('includes folders nested inside ~mods without listing ~mods twice', () => {
    fs.mkdirSync(path.join(paks, '~mods', 'Wrapper', 'Inner'), { recursive: true })
    const dirs = getAllPaksPaths(game)
    expect(dirs.filter(d => d.toLowerCase() === path.join(paks, '~mods').toLowerCase())).toHaveLength(1)
    expect(dirs).toContain(path.join(paks, '~mods', 'Wrapper'))
    expect(dirs).toContain(path.join(paks, '~mods', 'Wrapper', 'Inner'))
  })

  it('skips dot-folders and stops at the depth bound', () => {
    fs.mkdirSync(path.join(paks, '.git', 'objects'), { recursive: true })
    fs.mkdirSync(path.join(paks, 'a', 'b', 'c', 'd', 'e'), { recursive: true })
    const dirs = getAllPaksPaths(game)
    expect(dirs.some(d => d.includes('.git'))).toBe(false)
    expect(dirs).toContain(path.join(paks, 'a', 'b', 'c', 'd'))
    expect(dirs).not.toContain(path.join(paks, 'a', 'b', 'c', 'd', 'e'))
  })

  it('works when the game path points at the inner HumanitZ folder', () => {
    fs.mkdirSync(path.join(paks, 'mods'))
    const inner = path.join(game, 'HumanitZ')
    expect(getAllPaksPaths(inner)).toEqual([path.join(paks, '~mods'), paks, path.join(paks, 'mods')])
  })

  it('returns nothing when the game has no Paks folder', () => {
    const empty = path.join(root, 'NotAGame')
    fs.mkdirSync(empty)
    expect(getAllPaksPaths(empty)).toEqual([])
  })
})

describe('paks in subfolders — the player flow', () => {
  it('the Library lists paks in Paks/mods and in a folder inside ~mods, but not the base game pak', () => {
    touch('~mods/Top_P.pak')
    touch('mods/Nested_P.pak')
    touch('~mods/SomeMod/Wrapped_P.pak.disabled')
    const mods = scanMods()
    const byName = Object.fromEntries(mods.map(m => [m.filename, m]))
    expect(Object.keys(byName).sort()).toEqual(['Nested_P.pak', 'Top_P.pak', 'Wrapped_P.pak.disabled'])
    expect(byName['Nested_P.pak'].path).toBe(path.join(paks, 'mods', 'Nested_P.pak'))
    expect(byName['Nested_P.pak'].enabled).toBe(true)
    expect(byName['Wrapped_P.pak.disabled'].enabled).toBe(false)
  })

  it('a game-layout archive that ships Paks/mods/ installs there and shows up in the Library', async () => {
    const src = path.join(root, 'archive-src')
    const pakRel = path.join('HumanitZ', 'Content', 'Paks', 'mods', 'Nested_P.pak')
    fs.mkdirSync(path.dirname(path.join(src, pakRel)), { recursive: true })
    fs.writeFileSync(path.join(src, pakRel), 'NESTED')
    const zip = path.join(root, 'Nested.zip')
    execFileSync(path7za, ['a', '-tzip', zip, 'HumanitZ'], { cwd: src })

    const installed = await installMods([zip], null)
    expect(installed[0].type).toBe('game-structure')
    expect(fs.readFileSync(path.join(paks, 'mods', 'Nested_P.pak'), 'utf8')).toBe('NESTED')

    const listed = scanMods().find(m => m.filename === 'Nested_P.pak')
    expect(listed?.path).toBe(path.join(paks, 'mods', 'Nested_P.pak'))
  })

  it('toggle and remove reach a pak inside a subfolder', async () => {
    const pak = touch('mods/Nested_P.pak')
    const toggle = handlers.get('mods:toggle')
    const remove = handlers.get('mods:remove')

    const off = await toggle({}, 'Nested_P.pak')
    expect(off.enabled).toBe(false)
    expect(fs.existsSync(`${pak}.disabled`)).toBe(true)
    expect(fs.existsSync(pak)).toBe(false)

    const on = await toggle({}, 'Nested_P.pak.disabled')
    expect(on.enabled).toBe(true)
    expect(fs.existsSync(pak)).toBe(true)

    await remove({}, 'Nested_P.pak')
    expect(fs.existsSync(pak)).toBe(false)
    expect(scanMods().some(m => m.filename.startsWith('Nested_P'))).toBe(false)
  })

  it('vanilla launch also disables paks in subfolders', () => {
    const nested = touch('mods/Nested_P.pak')
    const modPaths = { paksPaths: getAllPaksPaths(game), ue4ssModsPath: null }
    const disabled = disableModsOnDisk(modPaths, scanMods())
    expect(disabled).toEqual([{ type: 'PAK', filename: 'Nested_P.pak' }])
    expect(fs.existsSync(`${nested}.disabled`)).toBe(true)
  })

  it('the conflict scan compares paks across subfolders', () => {
    touch('~mods/A_P.pak', 'Game/Shared.uasset')
    touch('mods/B_P.pak', 'Game/Shared.uasset')
    const readIndex = (file) => [fs.readFileSync(file, 'utf8')]
    expect(findConflicts(getAllPaksPaths(game), readIndex)).toEqual([
      { resource: 'Game/Shared.uasset', mods: ['A_P.pak', 'B_P.pak'] },
    ])
  })
})
