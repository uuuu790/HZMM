// Regression: profiles are an export/import format. handleImportProfile takes
// any .json the user was handed and validates only `name` and
// `enabledModFilenames`, so the `configSnapshot` that reaches
// profiles:restore-configs is fully attacker-controlled.
//
// resolveModConfigPath already stops a snapshot escaping the mod's own folder,
// but it says nothing about WHICH file inside that folder gets written. Before
// this guard a shared profile carrying
//   { "SomeMod": { "Scripts/main.lua": "<lua>" } }
// overwrote that mod's UE4SS entry point, which UE4SS executes unsandboxed on
// the next launch — arbitrary code execution from "I imported a friend's
// profile". The restore side now re-applies the exact predicate the snapshot
// side uses, so it can only write files a snapshot could have produced.
import { describe, it, expect } from 'vitest'
import { isSnapshotableConfigFile } from '../../src/main/ipc/mods-config.js'
import { CONFIG_EXTENSIONS } from '../../src/main/ipc/constants.js'

const exts = new Set(CONFIG_EXTENSIONS)
const excluded = new Set(['enabled.txt', '_hzmm_link.json'])
const ok = (p) => isSnapshotableConfigFile(p, exts, excluded)

describe('isSnapshotableConfigFile — files a restore may write', () => {
  it('accepts ordinary config formats', () => {
    for (const f of ['config.ini', 'settings.json', 'a.cfg', 'a.conf', 'a.toml', 'a.yaml', 'a.yml', 'a.xml']) {
      expect(ok(f), f).toBe(true)
    }
  })

  it('accepts .lua / .txt only when the name says config', () => {
    expect(ok('config.lua')).toBe(true)
    expect(ok('ModConfig.lua')).toBe(true)
    expect(ok('config.txt')).toBe(true)
  })

  it('judges nested paths by their basename', () => {
    expect(ok('Scripts/config.lua')).toBe(true)
    expect(ok('deep/nested/settings.json')).toBe(true)
  })
})

describe('isSnapshotableConfigFile — the code-execution vectors', () => {
  it('REJECTS a mod entry point, however it is spelled', () => {
    expect(ok('Scripts/main.lua')).toBe(false)
    expect(ok('main.lua')).toBe(false)
    expect(ok('Scripts/MAIN.LUA')).toBe(false)
    expect(ok('dlls/main.dll')).toBe(false)
  })

  it('REJECTS arbitrary Lua that is not named as config', () => {
    expect(ok('Scripts/payload.lua')).toBe(false)
    expect(ok('Scripts/init.lua')).toBe(false)
  })

  it('REJECTS executables and shell scripts outright', () => {
    for (const f of ['evil.exe', 'evil.bat', 'evil.cmd', 'evil.ps1', 'evil.dll', 'evil.vbs']) {
      expect(ok(f), f).toBe(false)
    }
  })

  it('REJECTS the state markers the app owns', () => {
    expect(ok('enabled.txt')).toBe(false)
    expect(ok('_hzmm_link.json')).toBe(false)
    expect(ok('_HZMM_LINK.JSON')).toBe(false)
  })

  it('REJECTS a plain readme (not configuration)', () => {
    expect(ok('readme.txt')).toBe(false)
    expect(ok('README.TXT')).toBe(false)
  })
})

describe('isSnapshotableConfigFile — robustness', () => {
  it('does not throw on odd input', () => {
    expect(ok('')).toBe(false)
    expect(ok('noext')).toBe(false)
    expect(ok('.ini')).toBe(false) // basename is ".ini", extname is "" → no ext
  })

  it('is case-insensitive on the extension', () => {
    expect(ok('Config.INI')).toBe(true)
    expect(ok('SETTINGS.JSON')).toBe(true)
  })
})
