import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Drives the real update flow (archive -> install -> renamed-pak cleanup ->
// receipt supersede -> state restore) against a temp game folder. Only the
// settings store, the logger and the Nexus file-list call are faked.
const h = vi.hoisted(() => ({ data: new Map(), dir: '', files: null }))
vi.mock('../../src/main/services/config-store', () => ({
  default: {
    get: (key, fallback = null) => (h.data.has(key) ? h.data.get(key) : fallback),
    set: (key, value) => { h.data.set(key, value) },
    remove: (key) => { h.data.delete(key) },
    getConfigDir: () => h.dir,
  },
}))
vi.mock('../../src/main/services/logger', () => ({
  default: { info: () => {}, warn: () => {}, error: () => {}, getPath: () => '', readRecent: () => [] },
}))
vi.mock('../../src/main/ipc/nexus-v2-client', async (importOriginal) => ({
  ...(await importOriginal()),
  v2GetModFiles: async () => {
    if (h.files instanceof Error) throw h.files
    return h.files
  },
}))

import { runUpdateWithStateRestore } from '../../src/main/ipc/mods-update-flow'
import { recordInstall } from '../../src/main/ipc/nexus-install-tracker'

// mods/143: the author renames the pak every version; both files share a group.
const OLD = 'bailing_4TierVehicleCamera_1.1X_v1.2.1'
const NEW = 'bailing_4TierVehicleCamera_1.1Z_v1.3.0'
const FILES_143 = [
  { file_id: 545, group_id: 8036034, name: 'bailing 4TierVehicleCamera 1.1X v1.2.1', category_id: 4 },
  { file_id: 569, group_id: 8036034, name: 'bailing 4TierVehicleCamera 1.1Z v1.3.0', category_id: 1 },
]

let root
let mods

beforeEach(() => {
  h.data.clear()
  h.files = null
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-flow-'))
  h.dir = path.join(root, 'config')
  fs.mkdirSync(h.dir, { recursive: true })
  const game = path.join(root, 'game')
  mods = path.join(game, 'HumanitZ', 'Content', 'Paks', '~mods')
  fs.mkdirSync(mods, { recursive: true })
  h.data.set('gamePath', game)
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

// What the real install step does with such an archive: land the new pak
// (always enabled) and record its receipt.
const installNew = (modId, fileId, name) => async () => {
  fs.writeFileSync(path.join(mods, `${name}_P.pak`), 'new')
  recordInstall(modId, fileId, [{ modType: 'PAK', name }])
  return { ok: true }
}

describe('update flow — a new version under a new pak filename', () => {
  it('replaces the old pak instead of mounting both, and keeps the user\'s "disabled" choice', async () => {
    fs.writeFileSync(path.join(mods, `${OLD}_P.pak.disabled`), 'old')
    h.data.set('nexusInstalledMods', [{ modId: 143, fileId: 545, installedAt: 1, version: '4', localMods: [{ modType: 'PAK', name: OLD }] }])
    h.data.set('profiles', [{ id: 'p', name: 'Main', enabledModFilenames: [`${OLD}_P.pak`] }])
    h.files = FILES_143

    const { wasUpdate } = await runUpdateWithStateRestore(143, 569, installNew(143, 569, NEW))

    expect(wasUpdate).toBe(true)
    expect(fs.readdirSync(mods)).toEqual([`${NEW}_P.pak.disabled`])
    const receipts = h.data.get('nexusInstalledMods')
    expect(receipts.map(r => r.fileId)).toEqual([569])
    expect(receipts[0].localMods).toEqual([{ modType: 'PAK', name: NEW }])
    expect(h.data.get('profiles')[0].enabledModFilenames).toEqual([`${NEW}_P.pak`])
    // The outgoing version stays available for one-click rollback.
    const snaps = fs.readdirSync(path.join(h.dir, 'mod-versions', '143'))
    expect(snaps).toHaveLength(1)
    expect(fs.readdirSync(path.join(h.dir, 'mod-versions', '143', snaps[0], 'paks'))).toEqual([`${OLD}_P.pak.disabled`])
  })

  it('leaves an installed variant alone when a different variant is installed (mods/34)', async () => {
    fs.writeFileSync(path.join(mods, 'BoB2x_P.pak'), 'client')
    h.data.set('nexusInstalledMods', [{ modId: 34, fileId: 307, installedAt: 1, localMods: [{ modType: 'PAK', name: 'BoB2x' }] }])
    h.files = [
      { file_id: 307, group_id: 301456, name: 'Beast of Burden Enhancement2x', category_id: 1 },
      { file_id: 558, group_id: 301468, name: 'BACKPACK50', category_id: 1 },
    ]

    const { wasUpdate } = await runUpdateWithStateRestore(34, 558, installNew(34, 558, 'BACKPACK50'))

    expect(wasUpdate).toBe(false)
    expect(fs.readdirSync(mods).sort()).toEqual(['BACKPACK50_P.pak', 'BoB2x_P.pak'])
  })

  it('removes nothing when the file list is unavailable (family unconfirmed)', async () => {
    fs.writeFileSync(path.join(mods, `${OLD}_P.pak`), 'old')
    h.data.set('nexusInstalledMods', [{ modId: 143, fileId: 545, installedAt: 1, localMods: [{ modType: 'PAK', name: OLD }] }])
    h.files = new Error('network down')

    await runUpdateWithStateRestore(143, 569, installNew(143, 569, NEW))

    expect(fs.readdirSync(mods).sort()).toEqual([`${NEW}_P.pak`, `${OLD}_P.pak`].sort())
  })
})
