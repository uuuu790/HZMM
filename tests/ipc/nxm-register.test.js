import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The portable build runs from a copy unpacked into %TEMP% (process.execPath),
// which the launcher deletes when HZMM exits. The nxm:// handler must point at
// the launcher the user runs (PORTABLE_EXECUTABLE_FILE), or a link clicked
// while HZMM is closed launches a file that no longer exists.

const calls = vi.hoisted(() => ({ set: [], remove: [], is: [] }))
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    setAsDefaultProtocolClient: (...a) => { calls.set.push(a); return true },
    removeAsDefaultProtocolClient: (...a) => { calls.remove.push(a); return true },
    isDefaultProtocolClient: (...a) => { calls.is.push(a); return true },
    getPath: () => '',
  },
  ipcMain: { handle: () => {} },
  net: {},
}))

const { registerNxmProtocol, unregisterNxmProtocol } = await import('../../src/main/ipc/nxm')

const saved = process.env.PORTABLE_EXECUTABLE_FILE

beforeEach(() => {
  calls.set.length = 0
  calls.remove.length = 0
})

afterEach(() => {
  if (saved === undefined) delete process.env.PORTABLE_EXECUTABLE_FILE
  else process.env.PORTABLE_EXECUTABLE_FILE = saved
})

describe('nxm protocol registration target', () => {
  it('registers the portable launcher, not the %TEMP% copy', () => {
    process.env.PORTABLE_EXECUTABLE_FILE = 'D:\\Games\\HZMM Manager.exe'
    registerNxmProtocol()
    unregisterNxmProtocol()
    expect(calls.set).toEqual([['nxm', 'D:\\Games\\HZMM Manager.exe', []]])
    expect(calls.remove).toEqual([['nxm', 'D:\\Games\\HZMM Manager.exe', []]])
  })

  it('falls back to the running exe outside the portable launcher', () => {
    delete process.env.PORTABLE_EXECUTABLE_FILE
    registerNxmProtocol()
    expect(calls.set).toEqual([['nxm', process.execPath, []]])
  })
})
