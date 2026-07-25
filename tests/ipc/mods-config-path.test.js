import { describe, it, expect } from 'vitest'
import path from 'path'
import { resolveModConfigPath, assertConfigExtension } from '../../src/main/ipc/mods-config.js'

// `electron` is aliased to tests/stubs/electron.js (see vitest.config.mjs), so
// this imports the real mods-config module rather than a stand-in.

const IS_WINDOWS = process.platform === 'win32'
const MODS_ROOT = IS_WINDOWS
  ? 'C:\\Game\\HumanitZ\\HumanitZ\\Binaries\\Win64\\Mods'
  : '/game/HumanitZ/HumanitZ/Binaries/Win64/Mods'

describe('resolveModConfigPath — happy path', () => {
  it('resolves a simple mod config path', () => {
    const result = resolveModConfigPath(MODS_ROOT, 'MyMod', 'config.ini')
    expect(result).toBe(path.resolve(MODS_ROOT, 'MyMod', 'config.ini'))
  })

  it('allows nested relative paths inside the mod folder', () => {
    const result = resolveModConfigPath(MODS_ROOT, 'MyMod', 'Scripts/settings.json')
    expect(result).toBe(path.resolve(MODS_ROOT, 'MyMod', 'Scripts', 'settings.json'))
  })
})

describe('resolveModConfigPath — attack vectors (must all throw)', () => {
  // Attack 1: modFilename contains .. to escape the Mods root entirely.
  // Before the fix, the old code only validated relativePath against modDir,
  // so modFilename='../../../Windows/System32' would happily resolve.
  it('blocks modFilename ../../../ escape', () => {
    expect(() =>
      resolveModConfigPath(MODS_ROOT, '../../../../../../Windows/System32', 'config.ini')
    ).toThrow(/traversal|invalid|must not|reserved/i)
  })

  it('blocks modFilename with backslash escape on Windows', () => {
    expect(() =>
      resolveModConfigPath(MODS_ROOT, '..\\..\\..\\Windows\\System32', 'hosts')
    ).toThrow(/traversal|invalid|must not|reserved/i)
  })

  // Attack 2: relativePath contains .. to escape the mod subfolder.
  it('blocks relativePath .. escape', () => {
    expect(() =>
      resolveModConfigPath(MODS_ROOT, 'MyMod', '../../../../etc/passwd')
    ).toThrow(/traversal|invalid|must not|reserved/i)
  })

  // Attack 3: both segments collaborate to escape.
  it('blocks combined modFilename + relativePath escape', () => {
    expect(() =>
      resolveModConfigPath(MODS_ROOT, '..', '..\\..\\Windows\\win.ini')
    ).toThrow(/traversal|invalid|must not|reserved/i)
  })

  // Attack 4: empty / null / non-string inputs.
  it('throws on empty modFilename', () => {
    expect(() => resolveModConfigPath(MODS_ROOT, '', 'config.ini')).toThrow()
  })

  it('throws on empty relativePath', () => {
    expect(() => resolveModConfigPath(MODS_ROOT, 'MyMod', '')).toThrow()
  })

  it('throws on null modFilename', () => {
    expect(() => resolveModConfigPath(MODS_ROOT, null, 'config.ini')).toThrow()
  })

  it('throws on non-string relativePath', () => {
    expect(() => resolveModConfigPath(MODS_ROOT, 'MyMod', 42)).toThrow()
  })

  it('throws on empty mods root', () => {
    expect(() => resolveModConfigPath('', 'MyMod', 'config.ini')).toThrow()
  })
})

describe('resolveModConfigPath — edge cases', () => {
  it('allows a safe subpath even when it contains a harmless ..', () => {
    // "Scripts/../Config/mod.ini" normalizes to "Config/mod.ini", still inside.
    const result = resolveModConfigPath(MODS_ROOT, 'MyMod', 'Scripts/../Config/mod.ini')
    expect(result).toBe(path.resolve(MODS_ROOT, 'MyMod', 'Config', 'mod.ini'))
  })

  it('does not treat a mod name with dots as traversal', () => {
    // "my.mod.v1" is a legitimate name; dots are only dangerous as ".." segments.
    const result = resolveModConfigPath(MODS_ROOT, 'my.mod.v1', 'config.ini')
    expect(result).toBe(path.resolve(MODS_ROOT, 'my.mod.v1', 'config.ini'))
  })
})

// PRIVILEGE-ESCALATION REGRESSION.
//
// The containment root is the MOD'S OWN FOLDER, not the Mods root. Fencing
// against the root meant every path below was "inside the Mods root" and
// therefore allowed — which turned mods:save-config into a write primitive for
// the UE4SS mod registry and for brand-new mod folders (i.e. arbitrary Lua that
// UE4SS then loads and executes).
describe('resolveModConfigPath — must not escape into a sibling mod or the Mods root', () => {
  const escapes = [
    '../mods.txt',
    '../mods.json',
    '../OtherMod/config.ini',
    '../NewMod/Scripts/main.lua',
    '..\\mods.txt',
    'Scripts/../../mods.txt',
    './../mods.json',
  ]

  for (const rel of escapes) {
    it(`blocks relativePath ${JSON.stringify(rel)}`, () => {
      expect(() => resolveModConfigPath(MODS_ROOT, 'MyMod', rel)).toThrow()
    })
  }

  it('still allows nested paths inside the mod folder', () => {
    expect(resolveModConfigPath(MODS_ROOT, 'MyMod', 'Scripts/settings.json'))
      .toBe(path.resolve(MODS_ROOT, 'MyMod', 'Scripts', 'settings.json'))
  })
})

// The config editor may only write recognised config files. Without this,
// save-config could drop any bytes under any filename inside the mod folder —
// including Scripts/main.lua, which UE4SS executes.
describe('assertConfigExtension', () => {
  it('accepts the documented config extensions', () => {
    for (const name of ['config.ini', 'a.cfg', 'a.conf', 'a.json', 'a.toml',
      'a.yaml', 'a.yml', 'a.lua', 'a.xml', 'a.txt']) {
      expect(() => assertConfigExtension(name)).not.toThrow()
    }
  })

  it('rejects anything else', () => {
    for (const name of ['payload.exe', 'run.url', 'main.dll', 'mod.pak',
      'script.bat', 'noextension', 'a.ps1']) {
      expect(() => assertConfigExtension(name)).toThrow(/not an editable config file/i)
    }
  })

  it('is case-insensitive', () => {
    expect(() => assertConfigExtension('CONFIG.INI')).not.toThrow()
    expect(() => assertConfigExtension('PAYLOAD.EXE')).toThrow()
  })
})
