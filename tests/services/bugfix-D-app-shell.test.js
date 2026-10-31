import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// config-store regression tests (real module, APPDATA pointed at a temp dir,
// fresh module instance per test so the in-memory cache starts empty):
//   - a UTF-8 BOM config.json (Notepad / PowerShell 5.1) loads normally
//   - valid JSON that is not an object is moved aside like any corrupt file
//   - save() retries a rename that Windows refuses while AV holds the file

vi.mock('electron', () => ({ app: {} }))

const savedAppData = process.env.APPDATA
let tmp
let dir
let file

async function freshStore() {
  vi.resetModules()
  return (await import('../../src/main/services/config-store')).default
}
const corruptBackups = () => fs.readdirSync(dir).filter(f => f.startsWith('config.json.corrupt-'))

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-D-config-'))
  process.env.APPDATA = tmp
  dir = path.join(tmp, 'hzmm-manager')
  file = path.join(dir, 'config.json')
  fs.mkdirSync(dir, { recursive: true })
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(tmp, { recursive: true, force: true })
})
afterAll(() => {
  if (savedAppData === undefined) delete process.env.APPDATA
  else process.env.APPDATA = savedAppData
})

describe('config-store load (gids 47, 48)', () => {
  it('reads a config.json that starts with a UTF-8 BOM', async () => {
    fs.writeFileSync(file, '\uFEFF' + JSON.stringify({ gamePath: 'C:\\G', nexusApiKey: 'abc' }), 'utf-8')
    const store = await freshStore()
    expect(store.get('gamePath')).toBe('C:\\G')
    expect(store.get('nexusApiKey')).toBe('abc')
    expect(corruptBackups()).toEqual([])
  })

  it.each(['null', '0', '[]', '"text"', 'true'])('moves a non-object root (%s) aside instead of throwing', async (content) => {
    fs.writeFileSync(file, content, 'utf-8')
    const store = await freshStore()
    expect(store.get('x', 'd')).toBe('d')
    expect(() => store.set('darkMode', true)).not.toThrow()
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ darkMode: true })
    const backups = corruptBackups()
    expect(backups.length).toBe(1)
    expect(fs.readFileSync(path.join(dir, backups[0]), 'utf-8')).toBe(content)
  })
})

describe('config-store save retries a locked rename (gid 49)', () => {
  const lockedError = (code) => Object.assign(new Error(`${code}: operation not permitted, rename`), { code })

  it('survives two EPERM renames and lands the value on disk', async () => {
    const realRename = fs.renameSync
    let failures = 2
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (failures-- > 0) throw lockedError('EPERM')
      return realRename(from, to)
    })
    const store = await freshStore()
    expect(() => store.set('minimizeToTray', false)).not.toThrow()
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ minimizeToTray: false })
    expect(fs.existsSync(file + '.tmp')).toBe(false)
  })

  it('gives up after bounded retries, rethrows and removes the .tmp', async () => {
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw lockedError('EBUSY') })
    const store = await freshStore()
    expect(() => store.set('darkMode', true)).toThrow(/EBUSY/)
    expect(rename.mock.calls.length).toBeGreaterThan(1)
    expect(rename.mock.calls.length).toBeLessThanOrEqual(10)
    expect(fs.existsSync(file + '.tmp')).toBe(false)
  })

  it('does not retry an error that is not a transient lock', async () => {
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw lockedError('ENOSPC') })
    const store = await freshStore()
    expect(() => store.set('darkMode', true)).toThrow(/ENOSPC/)
    expect(rename).toHaveBeenCalledTimes(1)
  })
})
