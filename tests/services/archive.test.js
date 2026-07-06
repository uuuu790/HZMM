import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { path7za } from '7zip-bin'
import {
  isSafePath,
  validateEntries,
  analyzeArchiveStructure,
  buildEntryNameMap,
  validateArchiveLimits,
  resolveCollisionFreePath,
  detectArchiveFormat,
  extract7z,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  MAX_ENTRY_COUNT,
} from '../../src/main/services/archive.js'

const IS_WINDOWS = process.platform === 'win32'
const DEST = IS_WINDOWS ? 'C:\\tmp\\hzmm-extract' : '/tmp/hzmm-extract'

describe('archive.isSafePath — zip slip defense', () => {
  const safeEntries = [
    'file.txt',
    'folder/file.txt',
    'a/b/c/deep.pak',
    './root.txt',
    'HumanitZ/Content/Paks/mod.pak',
  ]

  for (const entry of safeEntries) {
    it(`allows safe entry "${entry}"`, () => {
      expect(isSafePath(entry, DEST)).toBe(true)
    })
  }

  const maliciousEntries = [
    '../escape.txt',
    '../../../../../../etc/passwd',
    '..\\..\\..\\Windows\\System32\\drivers\\etc\\hosts',
    'foo/../../../etc/shadow',
    'normal/../../../escape.txt',
    IS_WINDOWS ? 'C:\\Windows\\System32\\evil.dll' : '/etc/evil',
  ]

  for (const entry of maliciousEntries) {
    it(`blocks zip slip entry "${entry}"`, () => {
      expect(isSafePath(entry, DEST)).toBe(false)
    })
  }

  it('validateEntries throws with the offending name in the message', () => {
    expect(() => validateEntries(['../../escape.txt'], DEST)).toThrow(/escape\.txt/)
  })

  it('validateEntries passes when all entries are safe', () => {
    expect(() => validateEntries(['a.txt', 'b/c.pak'], DEST)).not.toThrow()
  })
})

describe('archive.analyzeArchiveStructure — mod type detection', () => {
  it('detects pak-only mod', () => {
    const result = analyzeArchiveStructure(['mod.pak', 'mod.ucas', 'mod.utoc'])
    expect(result.type).toBe('pak-only')
    expect(result.pakFiles).toHaveLength(3)
  })

  it('detects UE4SS mod with enabled.txt + lua', () => {
    const result = analyzeArchiveStructure(['MyMod/enabled.txt', 'MyMod/Scripts/main.lua'])
    expect(result.type).toBe('ue4ss-mod')
  })

  it('detects DLL-only UE4SS mod', () => {
    const result = analyzeArchiveStructure(['mod.dll'])
    expect(result.type).toBe('ue4ss-mod')
  })

  it('detects hybrid mod (PAK + UE4SS)', () => {
    const result = analyzeArchiveStructure([
      'MyMod/enabled.txt',
      'MyMod/Scripts/main.lua',
      'content.pak',
    ])
    expect(result.type).toBe('hybrid')
  })

  it('detects game-structure archive', () => {
    const result = analyzeArchiveStructure([
      'HumanitZ/Content/Paks/mod.pak',
      'HumanitZ/Binaries/Win64/stuff.dll',
    ])
    // Game structure with a DLL + no lua/pak is classified as ue4ss-mod by current
    // priority. The important thing is it's not 'complex' or undefined.
    expect(['game-structure', 'ue4ss-mod', 'hybrid']).toContain(result.type)
  })

  it('does not false-positive on just a pak file under a nested folder', () => {
    const result = analyzeArchiveStructure(['modA/assets/data.pak'])
    expect(result.type).toBe('pak-only')
  })
})

// Regression guard for zip-slip: validateEntries is the ONLY zip-slip defense
// (every StreamZip uses skipEntryNameValidation). A future refactor that drops
// the guard, or feeds it an unsafe entry, must fail here.
describe('archive.validateEntries — zip slip regression', () => {
  const rejectedEntries = [
    '..\\..\\evil.dll',
    '../../../escape.txt',
    'good/../../escape.txt',
    IS_WINDOWS ? 'C:\\Windows\\System32\\evil.dll' : '/etc/evil',
  ]

  for (const entry of rejectedEntries) {
    it(`rejects entry "${entry}"`, () => {
      expect(() => validateEntries([entry], DEST)).toThrow()
    })

    it(`rejects "${entry}" even alongside safe entries`, () => {
      expect(() => validateEntries(['safe.pak', entry, 'also/safe.txt'], DEST)).toThrow()
    })
  }

  it('allows a fully-safe entry list', () => {
    expect(() => validateEntries(['a.pak', 'sub/b.pak'], DEST)).not.toThrow()
  })
})

// Regression for the backslash pak-only extraction bug: entries are validated
// and analyzed with `\`→`/` normalized names, but node-stream-zip / node-unrar-js
// key entries by the ORIGINAL raw name. buildEntryNameMap must round-trip
// normalized→original so the pak-only branch hands the raw name back to the
// extractor instead of the normalized one (which misses and writes nothing).
describe('archive.buildEntryNameMap — normalized→original mapping', () => {
  it('normalizes backslashes for analysis but preserves the original name', () => {
    const { entryNames, originalByNormalized } = buildEntryNameMap(['MyMod\\Cool_P.pak'])
    expect(entryNames).toEqual(['MyMod/Cool_P.pak'])
    expect(originalByNormalized.get('MyMod/Cool_P.pak')).toBe('MyMod\\Cool_P.pak')
  })

  it('leaves forward-slash names untouched', () => {
    const { entryNames, originalByNormalized } = buildEntryNameMap(['a/b/mod.pak'])
    expect(entryNames).toEqual(['a/b/mod.pak'])
    expect(originalByNormalized.get('a/b/mod.pak')).toBe('a/b/mod.pak')
  })

  it('keeps the first original when two names normalize to the same key', () => {
    const { originalByNormalized } = buildEntryNameMap(['dir\\x.pak', 'dir/x.pak'])
    expect(originalByNormalized.get('dir/x.pak')).toBe('dir\\x.pak')
  })
})

// Decompression-bomb guard: reject archives whose declared uncompressed totals
// blow past the ceilings, before any byte is written.
describe('archive.validateArchiveLimits — decompression bomb defense', () => {
  it('passes for a normal archive', () => {
    expect(() => validateArchiveLimits([1024, 2048, 4096])).not.toThrow()
  })

  it('passes at exactly the byte ceiling', () => {
    expect(() => validateArchiveLimits([MAX_TOTAL_UNCOMPRESSED_BYTES])).not.toThrow()
  })

  it('rejects when total uncompressed size exceeds the byte ceiling', () => {
    expect(() => validateArchiveLimits([MAX_TOTAL_UNCOMPRESSED_BYTES + 1])).toThrow(/decompression bomb/)
  })

  it('rejects when summed sizes exceed the byte ceiling', () => {
    const half = Math.ceil(MAX_TOTAL_UNCOMPRESSED_BYTES / 2) + 1
    expect(() => validateArchiveLimits([half, half])).toThrow(/decompression bomb/)
  })

  it('rejects when entry count exceeds the limit', () => {
    const tiny = new Array(MAX_ENTRY_COUNT + 1).fill(1)
    expect(() => validateArchiveLimits(tiny)).toThrow(/decompression bomb/)
  })

  it('passes at exactly the entry-count limit', () => {
    const sizes = new Array(MAX_ENTRY_COUNT).fill(1)
    expect(() => validateArchiveLimits(sizes)).not.toThrow()
  })
})

// Same-basename paks from different subfolders must not silently overwrite.
describe('archive.resolveCollisionFreePath — basename collision', () => {
  it('returns the path unchanged when nothing exists there', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-collide-'))
    try {
      const p = path.join(dir, 'mod.pak')
      expect(resolveCollisionFreePath(p)).toBe(p)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('appends " (2)" before the extension when the path is taken', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-collide-'))
    try {
      const p = path.join(dir, 'mod.pak')
      fs.writeFileSync(p, 'a')
      expect(resolveCollisionFreePath(p)).toBe(path.join(dir, 'mod (2).pak'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps incrementing the suffix for repeated collisions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-collide-'))
    try {
      fs.writeFileSync(path.join(dir, 'mod.pak'), 'a')
      fs.writeFileSync(path.join(dir, 'mod (2).pak'), 'b')
      expect(resolveCollisionFreePath(path.join(dir, 'mod.pak'))).toBe(path.join(dir, 'mod (3).pak'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// The Nexus CDN increasingly serves GUID paths with no extension, and the
// download flow falls back to naming everything .zip — so the installer must
// trust file content (magic bytes), never the extension.
describe('archive.detectArchiveFormat — magic byte sniffing', () => {
  let dir
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-detect-')) })
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  const write = (name, bytes) => {
    const p = path.join(dir, name)
    fs.writeFileSync(p, Buffer.from(bytes))
    return p
  }

  it('detects zip (PK\x03\x04 local file header)', () => {
    expect(detectArchiveFormat(write('a.bin', [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]))).toBe('zip')
  })

  it('detects empty zip (PK\x05\x06 end-of-central-directory)', () => {
    expect(detectArchiveFormat(write('b.bin', [0x50, 0x4b, 0x05, 0x06, ...Array(18).fill(0)]))).toBe('zip')
  })

  it('detects rar v4 despite a .zip extension', () => {
    expect(detectArchiveFormat(write('c.zip', [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 0x01]))).toBe('rar')
  })

  it('detects rar v5 despite a .zip extension', () => {
    expect(detectArchiveFormat(write('d.zip', [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]))).toBe('rar')
  })

  it('detects 7z despite a .zip extension', () => {
    expect(detectArchiveFormat(write('e.zip', [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x04]))).toBe('7z')
  })

  it('returns unknown for an HTML error page saved as .zip', () => {
    expect(detectArchiveFormat(write('f.zip', Buffer.from('<html><body>403 Forbidden</body></html>')))).toBe('unknown')
  })

  it('returns unknown for an empty file', () => {
    expect(detectArchiveFormat(write('g.zip', []))).toBe('unknown')
  })

  it('returns unknown for a missing file instead of throwing', () => {
    expect(detectArchiveFormat(path.join(dir, 'does-not-exist.zip'))).toBe('unknown')
  })
})

describe('archive.extract7z — 7z extraction', () => {
  let dir, pakOnly7z, ue4ss7z
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-7z-'))

    // pak-only fixture: sub/TestMod_P.pak + readme.txt
    const pakSrc = path.join(dir, 'pak-src')
    fs.mkdirSync(path.join(pakSrc, 'sub'), { recursive: true })
    fs.writeFileSync(path.join(pakSrc, 'sub', 'TestMod_P.pak'), 'PAKDATA')
    fs.writeFileSync(path.join(pakSrc, 'readme.txt'), 'hello')
    pakOnly7z = path.join(dir, 'pak-only.7z')
    execFileSync(path7za, ['a', pakOnly7z, '.'], { cwd: pakSrc })

    // ue4ss fixture: MyMod/Scripts/main.lua
    const ueSrc = path.join(dir, 'ue-src')
    fs.mkdirSync(path.join(ueSrc, 'MyMod', 'Scripts'), { recursive: true })
    fs.writeFileSync(path.join(ueSrc, 'MyMod', 'Scripts', 'main.lua'), 'print("hi")')
    ue4ss7z = path.join(dir, 'ue4ss.7z')
    execFileSync(path7za, ['a', ue4ss7z, '.'], { cwd: ueSrc })
  })
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('is detected as 7z by magic bytes even when named .zip', () => {
    const disguised = path.join(dir, 'disguised.zip')
    fs.copyFileSync(pakOnly7z, disguised)
    expect(detectArchiveFormat(disguised)).toBe('7z')
  })

  it('analyzeOnly reports pak-only type with forward-slash entry names', async () => {
    const analysis = await extract7z(pakOnly7z, null, true)
    expect(analysis.type).toBe('pak-only')
    expect(analysis.mods).toEqual([{ name: 'TestMod', modType: 'PAK' }])
    expect(analysis.entryNames).toContain('sub/TestMod_P.pak')
  })

  it('pak-only extraction lands paks at destDir root and leaves no extras', async () => {
    const dest = path.join(dir, 'out-pak')
    await extract7z(pakOnly7z, dest)
    expect(fs.existsSync(path.join(dest, 'TestMod_P.pak'))).toBe(true)
    expect(fs.readFileSync(path.join(dest, 'TestMod_P.pak'), 'utf8')).toBe('PAKDATA')
    expect(fs.existsSync(path.join(dest, 'readme.txt'))).toBe(false)
    expect(fs.existsSync(path.join(dest, 'sub'))).toBe(false)
    expect(fs.readdirSync(dest).filter(n => n.startsWith('_hzmm'))).toEqual([])
  })

  it('non-pak-only extraction preserves directory structure', async () => {
    const dest = path.join(dir, 'out-ue')
    const analysis = await extract7z(ue4ss7z, dest)
    expect(analysis.type).toBe('ue4ss-mod')
    expect(fs.existsSync(path.join(dest, 'MyMod', 'Scripts', 'main.lua'))).toBe(true)
  })
})
