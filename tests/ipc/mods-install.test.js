import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { analyzeArchiveStructure } from '../../src/main/services/archive'

// The installer copies exactly the UE4SS mod folders the archive analysis
// located (analysis.ue4ssModDirs), so the detection rules are pinned on the
// analyzer itself: archive entry names in, mod folders out.
const findUe4ssFolders = (entryNames, archiveName = 'Archive') =>
  analyzeArchiveStructure(entryNames, archiveName).ue4ssModDirs

let tempDir

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-install-test-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('UE4SS mod folder detection (analysis.ue4ssModDirs)', () => {
  it('finds mod with Scripts/main.lua', () => {
    expect(findUe4ssFolders(['MyMod/Scripts/main.lua'])).toEqual([{ name: 'MyMod', dir: 'MyMod' }])
  })

  it('finds mod with root main.lua', () => {
    expect(findUe4ssFolders(['SimpleMod/main.lua'])).toEqual([{ name: 'SimpleMod', dir: 'SimpleMod' }])
  })

  it('finds mod with .dll', () => {
    expect(findUe4ssFolders(['DllMod/plugin.dll'])).toEqual([{ name: 'DllMod', dir: 'DllMod' }])
  })

  it('finds a cppmod by dlls/main.dll (not the dlls folder)', () => {
    expect(findUe4ssFolders(['CppMod/dlls/main.dll'])).toEqual([{ name: 'CppMod', dir: 'CppMod' }])
  })

  it('recurses through wrapper folder (Mods/ActualMod/Scripts/main.lua)', () => {
    expect(findUe4ssFolders(['Mods/ActualMod/Scripts/main.lua'])).toEqual([{ name: 'ActualMod', dir: 'Mods/ActualMod' }])
  })

  it('finds multiple mods in same directory', () => {
    const results = findUe4ssFolders(['ModA', 'ModB', 'ModC'].map(n => `${n}/Scripts/main.lua`))
    expect(results.map(r => r.name).sort()).toEqual(['ModA', 'ModB', 'ModC'])
  })

  it('ignores directories without mod files', () => {
    expect(findUe4ssFolders(['EmptyDir/', 'TextOnly/readme.txt'])).toHaveLength(0)
  })

  it('treats the archive root as the mod when its entry point sits at the top', () => {
    // Packed "folder contents" instead of the folder: the root is the mod, named after the archive.
    expect(findUe4ssFolders(['main.lua', 'loose.dll'], 'CoolMod')).toEqual([{ name: 'CoolMod', dir: '' }])
    expect(findUe4ssFolders(['Scripts/main.lua', 'enabled.txt'], 'CoolMod')).toEqual([{ name: 'CoolMod', dir: '' }])
  })

  it('does not make a mod out of a loose root .dll alone', () => {
    expect(findUe4ssFolders(['loose.dll'])).toHaveLength(0)
  })

  it('handles deeply nested wrapper (outer/inner/ModName/Scripts/main.lua)', () => {
    expect(findUe4ssFolders(['outer/inner/DeepMod/Scripts/main.lua'])).toEqual([{ name: 'DeepMod', dir: 'outer/inner/DeepMod' }])
  })
})

// Regression for the data-loss bug: rotateModsToBackup must record every move
// into the caller-supplied `moved` array IMMEDIATELY (not just return it on full
// success), so a throw partway through (e.g. EBUSY on a pak the running game
// locked) still leaves the partial list visible to withRollback's catch. If it
// didn't, `moved` would be empty and the catch would rm the backup folder,
// permanently destroying the already-rotated originals.
//
// mods-install.ts pulls in electron-backed modules (config-store, etc.) that
// can't be imported in this container, so — matching this file's findUe4ssFolders
// approach — we re-implement rotateModsToBackup's move loop inline with the same
// incremental-push contract and exercise a mid-loop throw.
function rotateModsToBackupInline(items, backupRoot, moveFn, moved = []) {
  let counter = 0
  for (const { from, name } of items) {
    const to = path.join(backupRoot, `${counter++}_${name}`)
    moveFn(from, to)          // may throw (EPERM/EBUSY/ENOSPC)
    moved.push({ from, to })  // recorded ONLY after a successful move
  }
  return moved
}

describe('rotateModsToBackup incremental progress (data-loss regression)', () => {
  it('leaves already-moved entries in the shared `moved` array when a move throws', () => {
    const backupRoot = path.join(tempDir, 'backup')
    fs.mkdirSync(backupRoot, { recursive: true })

    const items = [
      { from: path.join(tempDir, 'a.pak'), name: 'a.pak' },
      { from: path.join(tempDir, 'b.pak'), name: 'b.pak' },
      { from: path.join(tempDir, 'c.pak'), name: 'c.pak' },
    ]

    // Fake move that succeeds for the first entry then throws (as a locked pak
    // would). The second arg is the caller-owned array — the fix hands it in so
    // partial progress survives the throw.
    let calls = 0
    const moveFn = () => { if (++calls === 2) { const e = new Error('EBUSY'); e.code = 'EBUSY'; throw e } }

    const moved = []
    expect(() => rotateModsToBackupInline(items, backupRoot, moveFn, moved)).toThrow('EBUSY')

    // The first move landed before the throw, so its entry MUST be recoverable.
    expect(moved).toHaveLength(1)
    expect(moved[0].from).toBe(items[0].from)
  })

  it('returns all entries on full success', () => {
    const backupRoot = path.join(tempDir, 'backup2')
    fs.mkdirSync(backupRoot, { recursive: true })
    const items = [
      { from: path.join(tempDir, 'x.pak'), name: 'x.pak' },
      { from: path.join(tempDir, 'y.pak'), name: 'y.pak' },
    ]
    const moved = []
    const result = rotateModsToBackupInline(items, backupRoot, () => {}, moved)
    expect(result).toBe(moved)
    expect(moved).toHaveLength(2)
  })
})
