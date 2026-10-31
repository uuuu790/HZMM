import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Regression tests for the pak-scan cluster: the base-game pak filter shared by
// the conflict scan and the mod scan, case-insensitive conflict keys, same-name
// copies in Paks/ and ~mods, non-frozen v9 paks, and the partial-scan flag when
// the UE4SS Mods dir can't be read.

const state = vi.hoisted(() => ({
  gamePath: null,
  paksPaths: [],
  ue4ssModsPath: null,
  config: {},
  set: null,
}))

vi.mock('electron', () => ({ ipcMain: { handle: () => {} }, app: {} }))
vi.mock('../../src/main/services/logger', () => ({
  default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))
vi.mock('../../src/main/services/config-store', () => ({
  default: {
    get: (key, def) => (key === 'gamePath' ? state.gamePath : (key in state.config ? state.config[key] : def)),
    set: (key, value) => state.set(key, value),
    getConfigDir: () => state.gamePath,
  },
}))
vi.mock('../../src/main/services/steam-detector', () => ({
  getAllPaksPaths: () => state.paksPaths,
  getUe4ssModsPath: () => state.ue4ssModsPath,
}))

import { findConflicts } from '../../src/main/ipc/conflicts'
import { scanMods, wasLastScanPartial } from '../../src/main/ipc/mods-scan'
import { getInstalledMods } from '../../src/main/ipc/nexus-install-tracker'
import { readPakIndex } from '../../src/main/services/pak-parser'
import { isBaseGamePak, PAK_MAGIC, FOOTER_READ_SIZE } from '../../src/main/services/pak-index'

let tempDir
let paksDir
let modsDir
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-a2-pak-scan-'))
  paksDir = path.join(tempDir, 'HumanitZ', 'Content', 'Paks')
  modsDir = path.join(paksDir, '~mods')
  fs.mkdirSync(modsDir, { recursive: true })
  state.gamePath = tempDir
  state.paksPaths = [modsDir, paksDir]
  state.ue4ssModsPath = null
  state.config = {}
  state.set = vi.fn()
})
afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function makeFile(dir, name, contents = 'fake-pak-bytes') {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), contents)
}
function stubReader(map) {
  return (filePath) => map[path.basename(filePath)] || []
}

describe('isBaseGamePak (shared by the mod scan and the conflict scan)', () => {
  it('skips engine paks in the base Paks dir', () => {
    expect(isBaseGamePak('pakchunk0-WindowsNoEditor.pak', 'C:\\Games\\HumanitZ\\HumanitZ\\Content\\Paks')).toBe(true)
    expect(isBaseGamePak('global.pak', 'C:\\Games\\HumanitZ\\HumanitZ\\Content\\Paks\\')).toBe(true)
    expect(isBaseGamePak('Global.utoc', '/games/HumanitZ/Content/Paks')).toBe(true)
  })

  it('does not treat a mod whose name merely starts with "global" as base-game', () => {
    expect(isBaseGamePak('GlobalLoot_P.pak', 'C:\\Games\\HumanitZ\\HumanitZ\\Content\\Paks')).toBe(false)
  })

  it('never skips anything in ~mods (case-insensitive dir name, either separator)', () => {
    expect(isBaseGamePak('pakchunk99-MyMod_P.pak', 'C:\\Games\\HumanitZ\\HumanitZ\\Content\\Paks\\~mods')).toBe(false)
    expect(isBaseGamePak('pakchunk99-MyMod_P.pak', 'C:\\Games\\HumanitZ\\HumanitZ\\Content\\Paks\\~Mods\\')).toBe(false)
    expect(isBaseGamePak('global.pak', '/games/HumanitZ/Content/Paks/~mods')).toBe(false)
  })
})

describe('findConflicts: paks the engine mounts are scanned', () => {
  it('scans an uppercase .PAK extension', () => {
    makeFile(modsDir, 'A_P.pak'); makeFile(modsDir, 'B_P.PAK')
    const reader = stubReader({
      'A_P.pak': ['/Game/Items/Sword.uasset'],
      'B_P.PAK': ['/Game/Items/Sword.uasset'],
    })
    expect(findConflicts([modsDir], reader)).toEqual([
      { resource: '/Game/Items/Sword.uasset', mods: ['A_P.pak', 'B_P.PAK'] },
    ])
  })

  it('scans a mod named Global*_P.pak in the base Paks dir', () => {
    makeFile(paksDir, 'GlobalLoot_P.pak'); makeFile(paksDir, 'Other_P.pak')
    const reader = stubReader({
      'GlobalLoot_P.pak': ['/Game/Items/Sword.uasset'],
      'Other_P.pak': ['/Game/Items/Sword.uasset'],
    })
    expect(findConflicts([paksDir], reader)).toEqual([
      { resource: '/Game/Items/Sword.uasset', mods: ['GlobalLoot_P.pak', 'Other_P.pak'] },
    ])
  })

  it('scans global*/pakchunk*-named mods in ~mods, but still skips engine paks in Paks/', () => {
    makeFile(modsDir, 'GlobalLootTweaks_P.pak')
    makeFile(modsDir, 'pakchunk99-MyMod_P.pak')
    makeFile(paksDir, 'pakchunk0-WindowsNoEditor.pak')
    makeFile(paksDir, 'global.pak')
    const reader = stubReader({
      'GlobalLootTweaks_P.pak': ['/Game/Items/Sword.uasset'],
      'pakchunk99-MyMod_P.pak': ['/Game/Items/Sword.uasset'],
      'pakchunk0-WindowsNoEditor.pak': ['/Game/Items/Sword.uasset'],
      'global.pak': ['/Game/Items/Sword.uasset'],
    })
    const out = findConflicts([modsDir, paksDir], reader)
    expect(out).toHaveLength(1)
    expect([...out[0].mods].sort()).toEqual(['GlobalLootTweaks_P.pak', 'pakchunk99-MyMod_P.pak'])
  })

  it('treats asset paths that differ only in case as the same resource', () => {
    makeFile(modsDir, 'A_P.pak'); makeFile(modsDir, 'D_P.pak')
    const reader = stubReader({
      'A_P.pak': ['/Game/Items/Sword.uasset'],
      'D_P.pak': ['/Game/items/sword.uasset'],
    })
    // The first-seen spelling is kept for display.
    expect(findConflicts([modsDir], reader)).toEqual([
      { resource: '/Game/Items/Sword.uasset', mods: ['A_P.pak', 'D_P.pak'] },
    ])
  })
})

describe('findConflicts: a same-name pak in Paks/ and ~mods is not a conflict with itself', () => {
  it('reports nothing when the only "other" pak is the same filename', () => {
    makeFile(modsDir, 'C_P.pak'); makeFile(paksDir, 'C_P.pak')
    const reader = stubReader({ 'C_P.pak': ['/Game/Other/Thing.uasset'] })
    expect(findConflicts([modsDir, paksDir], reader)).toEqual([])
  })

  it('matches the duplicate name case-insensitively (one Windows filename)', () => {
    makeFile(modsDir, 'C_P.pak'); makeFile(paksDir, 'c_p.pak')
    const reader = stubReader({ 'C_P.pak': ['/Game/Other/Thing.uasset'], 'c_p.pak': ['/Game/Other/Thing.uasset'] })
    expect(findConflicts([modsDir, paksDir], reader)).toEqual([])
  })

  it('lists the duplicated name once alongside a real competitor', () => {
    makeFile(modsDir, 'C_P.pak'); makeFile(paksDir, 'C_P.pak'); makeFile(modsDir, 'D_P.pak')
    const reader = stubReader({
      'C_P.pak': ['/Game/Other/Thing.uasset'],
      'D_P.pak': ['/Game/Other/Thing.uasset'],
    })
    const out = findConflicts([modsDir, paksDir], reader)
    expect(out).toHaveLength(1)
    expect([...out[0].mods].sort()).toEqual(['C_P.pak', 'D_P.pak'])
  })
})

describe('scanMods: base-game filter matches the conflict scan', () => {
  it('lists global*/pakchunk*-named mods in ~mods and Global*_P.pak in Paks/, hides engine paks', () => {
    makeFile(modsDir, 'GlobalLootTweaks_P.pak')
    makeFile(modsDir, 'pakchunk99-MyMod_P.pak')
    makeFile(modsDir, 'Normal_P.pak')
    makeFile(paksDir, 'GlobalStorage_P.pak')
    makeFile(paksDir, 'pakchunk0-WindowsNoEditor.pak')
    makeFile(paksDir, 'global.pak')
    const ids = scanMods().map(m => m.id).sort()
    expect(ids).toEqual(['GlobalLootTweaks_P.pak', 'GlobalStorage_P.pak', 'Normal_P.pak', 'pakchunk99-MyMod_P.pak'])
  })
})

// HZMM installs into the base Paks dir when ~mods doesn't exist (getPaksPath's
// fallback), so pakchunk-style mod names there must not be taken for engine
// chunks. Only names UnrealPak produces count as base game in Paks/.
describe('base Paks dir without ~mods: only engine-built pakchunk names are base game', () => {
  const BASE = 'C:\\Games\\HumanitZ\\HumanitZ\\Content\\Paks'

  it('isBaseGamePak still skips every engine chunk shape (any extension, any case)', () => {
    for (const name of [
      'pakchunk0-WindowsNoEditor.pak',
      'pakchunk0-WindowsNoEditor.ucas',
      'pakchunk0-WindowsNoEditor.utoc',
      'pakchunk0-WindowsNoEditor.sig',
      'pakchunk0-WindowsNoEditor.pak.disabled',
      'PAKCHUNK0-WINDOWSNOEDITOR.PAK',
      'pakchunk12-WindowsNoEditor.pak',
      'pakchunk0optional-WindowsNoEditor.pak',
      'pakchunk0_s1-WindowsNoEditor.pak',
      'pakchunk0-WindowsNoEditor_0_P.pak',
      'pakchunk0-Windows.pak',
      'pakchunk0-WindowsClient.pak',
      'pakchunk0-WindowsServer.pak',
      'global.ucas',
      'global.utoc',
    ]) {
      expect(isBaseGamePak(name, BASE), name).toBe(true)
    }
  })

  it('isBaseGamePak keeps pakchunk-style mod names visible', () => {
    for (const name of [
      'pakchunk99-MyMod_P.pak',
      'pakchunk99-MyMod_P.pak.disabled',
      'pakchunk99-WindowsNoEditor_P.pak',
      'pakchunk99-Mods_MyMod_P.pak',
      'pakchunk99_MyMod.pak',
      'pakchunk99.pak',
      'pakchunkMyMod_P.pak',
      'GlobalLoot_P.pak',
    ]) {
      expect(isBaseGamePak(name, BASE), name).toBe(false)
    }
  })

  function setupBaseOnly() {
    fs.rmSync(modsDir, { recursive: true, force: true })
    state.paksPaths = [paksDir]
    makeFile(paksDir, 'pakchunk0-WindowsNoEditor.pak')
    makeFile(paksDir, 'pakchunk0-WindowsNoEditor.ucas')
    makeFile(paksDir, 'pakchunk0-WindowsNoEditor.utoc')
    makeFile(paksDir, 'global.utoc')
    makeFile(paksDir, 'pakchunk99-MyMod_P.pak')
    makeFile(paksDir, 'pakchunk99-WindowsNoEditor_P.pak.disabled')
    makeFile(paksDir, 'Normal_P.pak')
  }

  it('scanMods lists pakchunk-named mods installed into Paks/ and hides the engine files', () => {
    setupBaseOnly()
    const mods = scanMods()
    expect(mods.map(m => m.id).sort()).toEqual(['Normal_P.pak', 'pakchunk99-MyMod_P.pak', 'pakchunk99-WindowsNoEditor_P.pak'])
    expect(mods.find(m => m.id === 'pakchunk99-WindowsNoEditor_P.pak').enabled).toBe(false)
    expect(wasLastScanPartial()).toBe(false)
  })

  it('findConflicts reports a pakchunk-named mod in Paks/ and ignores the engine chunk', () => {
    setupBaseOnly()
    makeFile(paksDir, 'pakchunk99-WindowsNoEditor_P.pak')
    const reader = stubReader({
      'pakchunk0-WindowsNoEditor.pak': ['/Game/Items/Sword.uasset'],
      'pakchunk99-MyMod_P.pak': ['/Game/Items/Sword.uasset'],
      'pakchunk99-WindowsNoEditor_P.pak': ['/Game/Items/Sword.uasset'],
    })
    const out = findConflicts([paksDir], reader)
    expect(out).toHaveLength(1)
    expect([...out[0].mods].sort()).toEqual(['pakchunk99-MyMod_P.pak', 'pakchunk99-WindowsNoEditor_P.pak'])
  })

  it('getInstalledMods keeps the receipt of a pakchunk-named mod in Paks/', () => {
    setupBaseOnly()
    // Receipt keys are the pak stem without `_P` (localModKey).
    state.config.nexusInstalledMods = [
      { modId: 7, fileId: 70, installedAt: 1, localMods: [{ name: 'pakchunk99-MyMod', modType: 'PAK' }] },
      { modId: 8, fileId: 80, installedAt: 1, localMods: [{ name: 'Normal', modType: 'PAK' }] },
    ]
    expect(getInstalledMods().map(r => r.modId)).toEqual([7, 8])
    expect(state.set).not.toHaveBeenCalled()
  })
})

describe('scanMods: an unreadable UE4SS Mods dir marks the scan partial', () => {
  function setupUnreadableUe4ss() {
    makeFile(modsDir, 'Pakky_P.pak')
    // Exists, but readdir throws (ENOTDIR) — stands in for an AV lock / EBUSY.
    const ue4ss = path.join(tempDir, 'Win64', 'ue4ss', 'Mods')
    makeFile(path.dirname(ue4ss), 'Mods', 'not a dir')
    state.ue4ssModsPath = ue4ss
  }

  it('sets wasLastScanPartial() and still returns the paks it could read', () => {
    setupUnreadableUe4ss()
    const ids = scanMods().map(m => m.id)
    expect(ids).toEqual(['Pakky_P.pak'])
    expect(wasLastScanPartial()).toBe(true)
  })

  it('is not partial when the UE4SS Mods dir reads fine', () => {
    makeFile(modsDir, 'Pakky_P.pak')
    const ue4ss = path.join(tempDir, 'Win64', 'ue4ss', 'Mods')
    makeFile(path.join(ue4ss, 'LuaMod', 'Scripts'), 'main.lua', '-- entry')
    state.ue4ssModsPath = ue4ss
    expect(scanMods().map(m => m.id).sort()).toEqual(['Pakky_P.pak', 'ue4ss:LuaMod'])
    expect(wasLastScanPartial()).toBe(false)
  })

  it('getInstalledMods keeps UE4SS receipts and writes nothing after such a scan', () => {
    setupUnreadableUe4ss()
    const receipts = [
      { modId: 1, fileId: 10, installedAt: 1, localMods: [{ name: 'LuaMod', modType: 'UE4SS' }] },
      { modId: 2, fileId: 20, installedAt: 1, localMods: [{ name: 'Pakky_P.pak', modType: 'PAK' }] },
    ]
    state.config.nexusInstalledMods = receipts
    expect(getInstalledMods().map(r => r.modId)).toEqual([1, 2])
    expect(state.set).not.toHaveBeenCalled()
  })
})

// ---- Synthetic pak files for readPakIndex ----
function fstr(s) {
  const body = Buffer.from(s, 'utf-8')
  const buf = Buffer.alloc(4 + body.length + 1)
  buf.writeInt32LE(body.length + 1, 0)
  body.copy(buf, 4)
  return buf
}
function i32(n) { const b = Buffer.alloc(4); b.writeInt32LE(n, 0); return b }
function legacyIndex(mount, names) {
  const parts = [fstr(mount), i32(names.length)]
  // Uncompressed FPakEntry: 3×int64 + method(0) + hash(20) + bEncrypted + blockSize.
  for (const n of names) parts.push(fstr(n), Buffer.alloc(8 + 8 + 8 + 4 + 20 + 1 + 4))
  return Buffer.concat(parts)
}
// [index][footer]; the magic sits where a real v9 footer puts it in the last
// FOOTER_READ_SIZE bytes (after the 16-byte key guid + bEncryptedIndex).
function writePak(name, version, index, frozen) {
  const footer = Buffer.alloc(FOOTER_READ_SIZE)
  const pos = 16
  footer.writeUInt32LE(PAK_MAGIC, pos)
  footer.writeInt32LE(version, pos + 4)
  footer.writeBigInt64LE(0n, pos + 8)
  footer.writeBigInt64LE(BigInt(index.length), pos + 16)
  if (version === 9) footer[pos + 44] = frozen ? 1 : 0
  const file = path.join(tempDir, name)
  fs.writeFileSync(file, Buffer.concat([index, footer]))
  return file
}

describe('readPakIndex: v9 paks', () => {
  const index = () => legacyIndex('../../../HumanitZ/Content/', ['Items/Sword.uasset', 'Items/Sword.uexp'])
  const expected = ['../../../HumanitZ/Content/Items/Sword.uasset', '../../../HumanitZ/Content/Items/Sword.uexp']

  it('parses a non-frozen v9 index as the legacy inline layout', () => {
    expect(readPakIndex(writePak('v9.pak', 9, index(), false))).toEqual(expected)
  })

  it('parses the same index under a v8 footer identically', () => {
    expect(readPakIndex(writePak('v8.pak', 8, index(), false))).toEqual(expected)
  })

  it('returns [] for a frozen v9 index', () => {
    expect(readPakIndex(writePak('v9f.pak', 9, index(), true))).toEqual([])
  })
})
