import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// These tests exercise the REAL functions from mods-install.js.
//
// They used to re-implement findUe4ssFolders and rotateModsToBackup inline,
// because importing mods-install pulled in `electron` (unavailable outside an
// Electron runtime). That meant the actual shipped functions had no coverage at
// all: the data-loss regression test could stay green while the code it was
// named after regressed — and it did, twice (the ".." mod name and the missing
// .ucas/.utoc rotation both live in rotateModsToBackup).
//
// `electron` is now aliased to tests/stubs/electron.js in vitest.config.mjs, and
// APPDATA is pointed at a scratch directory below so config-store resolves
// somewhere disposable. Both must be set before the import is evaluated.
process.env.APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-appdata-'))

const { findUe4ssFolders, rotateModsToBackup } = await import('../../src/main/ipc/mods-install.js')
const configStore = (await import('../../src/main/services/config-store.js')).default

let tempDir

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-install-test-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('findUe4ssFolders', () => {
  it('finds mod with Scripts/main.lua', () => {
    const modDir = path.join(tempDir, 'MyMod', 'Scripts')
    fs.mkdirSync(modDir, { recursive: true })
    fs.writeFileSync(path.join(modDir, 'main.lua'), '')
    const results = findUe4ssFolders(tempDir)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('MyMod')
  })

  it('finds mod with root main.lua', () => {
    const modDir = path.join(tempDir, 'SimpleMod')
    fs.mkdirSync(modDir)
    fs.writeFileSync(path.join(modDir, 'main.lua'), '')
    const results = findUe4ssFolders(tempDir)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('SimpleMod')
  })

  it('finds mod with .dll', () => {
    const modDir = path.join(tempDir, 'DllMod')
    fs.mkdirSync(modDir)
    fs.writeFileSync(path.join(modDir, 'plugin.dll'), '')
    const results = findUe4ssFolders(tempDir)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('DllMod')
  })

  it('finds a cppmod laid out as <Mod>/dlls/main.dll', () => {
    const modDir = path.join(tempDir, 'CppMod', 'dlls')
    fs.mkdirSync(modDir, { recursive: true })
    fs.writeFileSync(path.join(modDir, 'main.dll'), '')
    const results = findUe4ssFolders(tempDir)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('CppMod')
  })

  it('recurses through wrapper folder (Mods/ActualMod/Scripts/main.lua)', () => {
    const modDir = path.join(tempDir, 'Mods', 'ActualMod', 'Scripts')
    fs.mkdirSync(modDir, { recursive: true })
    fs.writeFileSync(path.join(modDir, 'main.lua'), '')
    const results = findUe4ssFolders(tempDir)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('ActualMod')
  })

  it('finds multiple mods in same directory', () => {
    for (const name of ['ModA', 'ModB', 'ModC']) {
      const dir = path.join(tempDir, name, 'Scripts')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'main.lua'), '')
    }
    const results = findUe4ssFolders(tempDir)
    expect(results).toHaveLength(3)
    expect(results.map((r) => r.name).sort()).toEqual(['ModA', 'ModB', 'ModC'])
  })

  it('ignores directories without mod files', () => {
    fs.mkdirSync(path.join(tempDir, 'EmptyDir'))
    fs.mkdirSync(path.join(tempDir, 'TextOnly'))
    fs.writeFileSync(path.join(tempDir, 'TextOnly', 'readme.txt'), '')
    expect(findUe4ssFolders(tempDir)).toHaveLength(0)
  })

  it('ignores loose files at root', () => {
    fs.writeFileSync(path.join(tempDir, 'main.lua'), '')
    fs.writeFileSync(path.join(tempDir, 'loose.dll'), '')
    expect(findUe4ssFolders(tempDir)).toHaveLength(0)
  })

  it('handles deeply nested wrapper (outer/inner/ModName/Scripts/main.lua)', () => {
    const modDir = path.join(tempDir, 'outer', 'inner', 'DeepMod', 'Scripts')
    fs.mkdirSync(modDir, { recursive: true })
    fs.writeFileSync(path.join(modDir, 'main.lua'), '')
    const results = findUe4ssFolders(tempDir)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('DeepMod')
  })
})

// Build a throwaway game tree that getPaksPath/getUe4ssModsPath will resolve.
function makeGameTree(root) {
  const paks = path.join(root, 'HumanitZ', 'Content', 'Paks', '~mods')
  const ue4ssMods = path.join(root, 'HumanitZ', 'Binaries', 'Win64', 'ue4ss', 'Mods')
  fs.mkdirSync(paks, { recursive: true })
  fs.mkdirSync(ue4ssMods, { recursive: true })
  return { paks, ue4ssMods }
}

describe('rotateModsToBackup', () => {
  let gamePath, backupRoot, tree

  beforeEach(() => {
    gamePath = path.join(tempDir, 'game')
    tree = makeGameTree(gamePath)
    backupRoot = path.join(tempDir, 'backup')
    fs.mkdirSync(backupRoot, { recursive: true })
    configStore.set('gamePath', gamePath)
  })

  it('rotates an existing pak aside', () => {
    fs.writeFileSync(path.join(tree.paks, 'TestMod_P.pak'), 'PAK')
    const moved = rotateModsToBackup(gamePath, [{ name: 'TestMod', modType: 'PAK' }], backupRoot)
    expect(moved).toHaveLength(1)
    expect(fs.existsSync(path.join(tree.paks, 'TestMod_P.pak'))).toBe(false)
    expect(fs.readFileSync(moved[0].to, 'utf-8')).toBe('PAK')
  })

  // DATA-LOSS REGRESSION: IoStore mods are a .pak/.ucas/.utoc triple that must
  // keep matching basenames. Rotating only the .pak left the stale containers in
  // place, so the incoming ones collided into "TestMod_P (2).ucas".
  it('rotates the whole .pak/.ucas/.utoc family, not just the .pak', () => {
    for (const ext of ['.pak', '.ucas', '.utoc']) {
      fs.writeFileSync(path.join(tree.paks, `TestMod_P${ext}`), ext)
    }
    const moved = rotateModsToBackup(gamePath, [{ name: 'TestMod', modType: 'PAK' }], backupRoot)
    expect(moved).toHaveLength(3)
    for (const ext of ['.pak', '.ucas', '.utoc']) {
      expect(fs.existsSync(path.join(tree.paks, `TestMod_P${ext}`))).toBe(false)
    }
  })

  it('rotates disabled variants too', () => {
    fs.writeFileSync(path.join(tree.paks, 'TestMod_P.pak.disabled'), 'PAK')
    const moved = rotateModsToBackup(gamePath, [{ name: 'TestMod', modType: 'PAK' }], backupRoot)
    expect(moved).toHaveLength(1)
  })

  it('rotates a UE4SS mod folder', () => {
    const modDir = path.join(tree.ue4ssMods, 'MyMod')
    fs.mkdirSync(modDir, { recursive: true })
    fs.writeFileSync(path.join(modDir, 'main.lua'), 'x')
    const moved = rotateModsToBackup(gamePath, [{ name: 'MyMod', modType: 'UE4SS' }], backupRoot)
    expect(moved).toHaveLength(1)
    expect(fs.existsSync(modDir)).toBe(false)
  })

  // DATA-LOSS REGRESSION — the headline bug from the review.
  //
  // Mod names are derived from ARCHIVE ENTRY PATHS, and this function runs
  // BEFORE the extractor's zip-slip validation (rotation happens in
  // withRollback, extraction inside the work() callback it wraps). A name of
  // ".." therefore resolved to the PARENT of the Mods directory — the whole
  // ue4ss/ tree — and moved it into the rollback backup.
  it('refuses a traversing mod name instead of moving the Mods parent', () => {
    const ue4ssRoot = path.dirname(tree.ue4ssMods)
    fs.writeFileSync(path.join(ue4ssRoot, 'UE4SS.dll'), 'ENGINE')

    const moved = rotateModsToBackup(gamePath, [{ name: '..', modType: 'UE4SS' }], backupRoot)

    expect(moved).toEqual([])
    expect(fs.existsSync(ue4ssRoot)).toBe(true)
    expect(fs.readFileSync(path.join(ue4ssRoot, 'UE4SS.dll'), 'utf-8')).toBe('ENGINE')
  })

  it.each(['.', '..', 'a/b', 'a\\b', '', null, 42])(
    'refuses unsafe mod name %p',
    (name) => {
      const moved = rotateModsToBackup(gamePath, [{ name, modType: 'UE4SS' }], backupRoot)
      expect(moved).toEqual([])
    }
  )

  it('keeps rotating the safe mods when one entry is unsafe', () => {
    fs.writeFileSync(path.join(tree.paks, 'Good_P.pak'), 'PAK')
    const moved = rotateModsToBackup(
      gamePath,
      [{ name: '..', modType: 'UE4SS' }, { name: 'Good', modType: 'PAK' }],
      backupRoot
    )
    expect(moved).toHaveLength(1)
    expect(moved[0].from).toBe(path.join(tree.paks, 'Good_P.pak'))
  })

  // DATA-LOSS REGRESSION: every move must be recorded in the caller-supplied
  // `moved` array IMMEDIATELY, not returned only on full success. A throw
  // partway through (EBUSY on a pak the running game locked) must still leave
  // the partial list visible to withRollback's catch — otherwise `moved` is
  // empty, the catch deletes the backup folder, and the already-rotated
  // originals are gone for good.
  it('leaves already-moved entries in the shared `moved` array when a move throws', () => {
    fs.writeFileSync(path.join(tree.paks, 'ModA_P.pak'), 'A')
    fs.writeFileSync(path.join(tree.paks, 'ModB_P.pak'), 'B')

    const realRename = fs.renameSync.bind(fs)
    let calls = 0
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (++calls === 2) {
        const err = new Error('EBUSY: resource busy or locked')
        err.code = 'EBUSY'
        throw err
      }
      return realRename(from, to)
    })

    const moved = []
    expect(() =>
      rotateModsToBackup(
        gamePath,
        [{ name: 'ModA', modType: 'PAK' }, { name: 'ModB', modType: 'PAK' }],
        backupRoot,
        moved
      )
    ).toThrow(/EBUSY/)

    // The first move landed before the throw, so it MUST be recoverable.
    expect(moved).toHaveLength(1)
    expect(moved[0].from).toBe(path.join(tree.paks, 'ModA_P.pak'))
    expect(fs.existsSync(moved[0].to)).toBe(true)
  })

  it('returns all entries on full success', () => {
    fs.writeFileSync(path.join(tree.paks, 'X_P.pak'), 'X')
    fs.writeFileSync(path.join(tree.paks, 'Y_P.pak'), 'Y')
    const moved = []
    const result = rotateModsToBackup(
      gamePath,
      [{ name: 'X', modType: 'PAK' }, { name: 'Y', modType: 'PAK' }],
      backupRoot,
      moved
    )
    expect(result).toBe(moved)
    expect(moved).toHaveLength(2)
  })

  it('is a no-op when nothing is installed', () => {
    expect(rotateModsToBackup(gamePath, [{ name: 'Absent', modType: 'PAK' }], backupRoot)).toEqual([])
  })
})
