import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { findStalePortableUnpacks, STALE_UNPACK_MIN_AGE_MS } from '../../src/main/services/portable-cleanup'

// A killed portable launcher leaves its whole %TEMP% unpack behind (~820 MB).
// The sweep must take exactly those folders: launcher-made, holding an HZMM
// copy, not the running one, idle for an hour — and nothing else in TEMP.

let temp
const NOW = Date.now()
const OLD = (NOW - STALE_UNPACK_MIN_AGE_MS - 60_000) / 1000
const FRESH = (NOW - 60_000) / 1000

function hzmmCopy(dir) {
  fs.mkdirSync(path.join(dir, 'resources'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'HZMM Manager.exe'), 'exe')
  fs.writeFileSync(path.join(dir, 'resources', 'app.asar'), 'asar')
}

function folder(name, fill, mtime) {
  const dir = path.join(temp, name)
  fs.mkdirSync(dir, { recursive: true })
  fill(dir)
  fs.utimesSync(dir, mtime, mtime)
  return dir
}

beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-sweep-'))
})
afterEach(() => {
  fs.rmSync(temp, { recursive: true, force: true })
})

describe('findStalePortableUnpacks', () => {
  it('takes leftover launcher folders and nothing else', () => {
    const ns = folder('nsA1B2.tmp', d => hzmmCopy(path.join(d, 'app')), OLD)
    const midExtract = folder('nsC3D4.tmp', d => hzmmCopy(path.join(d, '7z-out')), OLD)
    const oldBuild = folder('3M9Awqz4uqVjchMMExRsFwCrQLg', hzmmCopy, OLD)
    folder('nsE5F6.tmp', d => hzmmCopy(path.join(d, 'app')), FRESH)                  // a launch unpacking now
    folder('nsG7H8.tmp', d => fs.writeFileSync(path.join(d, 'setup.dat'), 'x'), OLD)  // another installer
    folder('MyStuff', hzmmCopy, OLD)                                                  // not a launcher name
    folder('nsJ9K0.tmp', d => fs.mkdirSync(path.join(d, 'app')), OLD)                // empty app folder
    const own = folder('nsL1M2.tmp', d => hzmmCopy(path.join(d, 'app')), OLD)
    const ownExe = path.join(own, 'app', 'HZMM Manager.exe')

    expect(findStalePortableUnpacks([temp], ownExe, NOW).sort()).toEqual([ns, midExtract, oldBuild].sort())
  })

  it('lists a folder once when the same TEMP is passed twice', () => {
    const ns = folder('nsA1B2.tmp', d => hzmmCopy(path.join(d, 'app')), OLD)
    expect(findStalePortableUnpacks([temp, temp + path.sep], 'C:\\elsewhere\\HZMM Manager.exe', NOW)).toEqual([ns])
  })

  it('skips a TEMP folder that cannot be read', () => {
    expect(findStalePortableUnpacks([path.join(temp, 'missing')], 'x', NOW)).toEqual([])
  })
})
