import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Regression tests for the app-shell cluster:
//   - in a portable build, auto-start and the taskbar pin use the PERSISTENT
//     portable exe (PORTABLE_EXECUTABLE_FILE), not the temp copy the launcher
//     deletes on exit. nxm:// points at the running exe while HZMM runs (warm
//     clicks must not go through the launcher) and is handed to the
//     persistent exe on quit / session end (cold clicks).
//   - the updater batch is pure ASCII; its paths travel in the environment
//   - shell:open-external accepts plain mailto: links and never leaks a
//     rejected openExternal promise
// The real main entry (index.ts) is imported, as a packaged portable build,
// with Electron and every unrelated IPC module faked. Its handlers land in
// state.handlers.

const state = vi.hoisted(() => ({
  handlers: new Map(),
  appOn: new Map(),
  windowOn: new Map(),
  appDetails: [],
  config: {},
  configDir: null,
  isPackaged: true,
  loginItem: { openAtLogin: true },
  // Fake HKCU\Software\Classes\nxm command: the exe it launches, or null.
  nxmReg: null,
  verified: null,
}))

const electronMocks = vi.hoisted(() => {
  const webContents = { on: () => {}, once: () => {}, send: () => {}, setWindowOpenHandler: () => {}, setZoomFactor: () => {} }
  class BrowserWindow {
    constructor() { this.webContents = webContents }
    on(event, fn) { state.windowOn.set(event, fn) }
    setIcon() {}
    setAppDetails(details) { state.appDetails.push(details) }
    loadURL() {}
    loadFile() {}
    isDestroyed() { return false }
  }
  class Tray {
    setToolTip() {}
    setContextMenu() {}
    on() {}
  }
  return {
    BrowserWindow,
    Tray,
    app: {
      getLoginItemSettings: () => {},
      setLoginItemSettings: () => {},
      // Mirrors Electron on Windows: remove only deletes a matching command.
      setAsDefaultProtocolClient: (_p, exe) => { state.nxmReg = exe; return true },
      removeAsDefaultProtocolClient: (_p, exe) => { if (state.nxmReg === exe) state.nxmReg = null; return true },
      isDefaultProtocolClient: (_p, exe) => state.nxmReg === exe,
      requestSingleInstanceLock: () => true,
      whenReady: () => Promise.resolve(),
      setAppUserModelId: () => {},
      setName: () => {},
      getVersion: () => '0.0.0-test',
      getPath: () => 'C:\\Users\\u\\AppData\\Local\\Temp\\2abc\\HZMM Manager.exe',
      quit: () => {},
    },
    shell: { openExternal: () => Promise.resolve(), openPath: () => '', showItemInFolder: () => {} },
    spawn: () => ({ on: () => {}, unref: () => {} }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, getPath: () => '', readRecent: () => [] },
  }
})

vi.mock('electron', () => {
  const app = electronMocks.app
  Object.defineProperty(app, 'isPackaged', { get: () => state.isPackaged, configurable: true })
  app.on = (event, fn) => state.appOn.set(event, fn)
  return {
    app,
    BrowserWindow: electronMocks.BrowserWindow,
    Tray: electronMocks.Tray,
    shell: electronMocks.shell,
    ipcMain: { handle: (channel, fn) => state.handlers.set(channel, fn) },
    Menu: { buildFromTemplate: () => ({}) },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
    screen: {},
    dialog: {},
  }
})
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal()),
  spawn: (...args) => electronMocks.spawn(...args),
}))
vi.mock('electron-window-state', () => ({
  default: () => ({ x: 0, y: 0, width: 1280, height: 800, manage: () => {} }),
}))
vi.mock('../../src/main/services/logger', () => ({ default: electronMocks.logger }))
vi.mock('../../src/main/services/config-store', () => ({
  default: {
    get: (key, def = null) => (Object.hasOwn(state.config, key) ? state.config[key] : def),
    set: (key, value) => { state.config[key] = value },
    getConfigDir: () => state.configDir,
  },
}))
vi.mock('../../src/main/services/main-text', () => ({
  mainText: () => ({ trayShow: 'Show', trayQuit: 'Quit', modFiles: 'Mods', allFiles: 'All' }),
}))
vi.mock('../../src/main/services/app-updater', () => ({
  checkForUpdate: async () => ({ hasUpdate: false }),
  downloadUpdate: async () => '',
  computeFileHash: async () => 'hash-1',
  getVerifiedUpdate: () => state.verified,
}))
vi.mock('../../src/main/ipc/locale', () => ({
  registerLocaleIpc: () => {},
  currentLocale: () => 'en',
  onLocaleChange: () => {},
}))
vi.mock('../../src/main/ipc/mods', () => ({ registerModsIpc: () => {} }))
vi.mock('../../src/main/ipc/mods-config', () => ({ registerModsConfigIpc: () => {} }))
vi.mock('../../src/main/ipc/mods-profiles', () => ({ registerModsProfilesIpc: () => {} }))
vi.mock('../../src/main/ipc/mods-readme', () => ({ registerModsReadmeIpc: () => {} }))
vi.mock('../../src/main/ipc/saves', () => ({ registerSavesIpc: () => {} }))
vi.mock('../../src/main/ipc/ue4ss', () => ({ registerUe4ssIpc: () => {} }))
vi.mock('../../src/main/ipc/game', () => ({ registerGameIpc: () => {}, startGameRunningPolling: () => {} }))
vi.mock('../../src/main/ipc/conflicts', () => ({ registerConflictsIpc: () => {} }))
vi.mock('../../src/main/ipc/nexus', () => ({ registerNexusIpc: () => {} }))
vi.mock('../../src/main/ipc/steam-workshop-ipc', () => ({ registerSteamWorkshopIpc: () => {} }))
vi.mock('../../src/main/ipc/mods-install', () => ({ cleanupStaleRollback: () => {} }))
vi.mock('../../src/main/ipc/mods-download', () => ({
  cleanupStaleDownloadTemp: () => {},
  resolveNexusDownloadUrl: async () => ({}),
  downloadAndInstallResolvedFile: async () => ({}),
}))
vi.mock('../../src/main/ipc/nexus-install-tracker', () => ({ recordInstall: () => {}, flattenLandedMods: () => [] }))
vi.mock('../../src/main/ipc/mods-update-flow', () => ({ runUpdateWithStateRestore: async () => ({}) }))
vi.mock('../../src/main/ipc/nexus-v2-client', () => ({ GAME_DOMAIN: 'humanitz' }))

const PORTABLE = 'D:\\Games\\HZMM Manager.exe'
// The exe this test process runs from stands in for the launcher's temp copy.
const RUNNING = process.execPath
const OTHER_MANAGER = 'C:\\Vortex\\Vortex.exe'
const savedPortable = process.env.PORTABLE_EXECUTABLE_FILE
const savedResourcesPath = process.resourcesPath
let getLogin, setLogin, setProto, removeProto, isProto
let startupGetCalls, startupSetCalls, startupProtoCalls, startupAppDetails
let nxm

beforeAll(async () => {
  process.env.PORTABLE_EXECUTABLE_FILE = PORTABLE
  process.resourcesPath = 'C:\\Users\\u\\AppData\\Local\\Temp\\2abc\\resources'
  state.config.nxmHandlerEnabled = true
  const app = electronMocks.app
  getLogin = vi.spyOn(app, 'getLoginItemSettings').mockImplementation(() => state.loginItem)
  setLogin = vi.spyOn(app, 'setLoginItemSettings')
  setProto = vi.spyOn(app, 'setAsDefaultProtocolClient')
  removeProto = vi.spyOn(app, 'removeAsDefaultProtocolClient')
  isProto = vi.spyOn(app, 'isDefaultProtocolClient')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await import('../../src/main/index')
  // whenReady().then(...) runs the startup re-registrations and createWindow
  await new Promise(r => setTimeout(r, 0))
  startupGetCalls = getLogin.mock.calls.slice()
  startupSetCalls = setLogin.mock.calls.slice()
  startupProtoCalls = setProto.mock.calls.slice()
  startupAppDetails = state.appDetails.slice()
  nxm = await import('../../src/main/ipc/nxm')
})

afterAll(() => {
  if (savedPortable === undefined) delete process.env.PORTABLE_EXECUTABLE_FILE
  else process.env.PORTABLE_EXECUTABLE_FILE = savedPortable
  if (savedResourcesPath === undefined) delete process.resourcesPath
  else process.resourcesPath = savedResourcesPath
})

beforeEach(() => {
  process.env.PORTABLE_EXECUTABLE_FILE = PORTABLE
  for (const spy of [getLogin, setLogin, setProto, removeProto, isProto]) spy.mockClear()
})

describe('portable build: auto-start and the taskbar pin use the persistent exe (gids 35, 44)', () => {
  it('startup re-assert of auto-start compares and writes the persistent exe', () => {
    expect(startupGetCalls).toEqual([[{ path: PORTABLE }]])
    expect(startupSetCalls).toEqual([[{ openAtLogin: true, path: PORTABLE }]])
  })

  it('the taskbar pin relaunches the persistent exe, with its icon', () => {
    // Electron ignores relaunchDisplayName unless relaunchCommand is set too;
    // without both, Windows pins the temp exe the launcher deletes on exit.
    expect(startupAppDetails).toEqual([{
      appId: 'com.hzmm.mod-manager',
      appIconPath: PORTABLE,
      appIconIndex: 0,
      relaunchDisplayName: 'HZMM Manager',
      relaunchCommand: `"${PORTABLE}"`,
    }])
  })

  it('app:get-auto-start / app:set-auto-start pass the persistent exe', async () => {
    state.loginItem = { openAtLogin: false }
    expect(await state.handlers.get('app:get-auto-start')({})).toBe(false)
    expect(getLogin).toHaveBeenCalledWith({ path: PORTABLE })
    await state.handlers.get('app:set-auto-start')({}, true)
    await state.handlers.get('app:set-auto-start')({}, 'yes')
    expect(setLogin.mock.calls).toEqual([
      [{ openAtLogin: true, path: PORTABLE }],
      [{ openAtLogin: false, path: PORTABLE }],
    ])
  })

})

// Warm path: a click while HZMM runs must reach second-instance through the
// running exe. Registering the portable launcher would run it on every click,
// and it wipes and re-extracts the running instance's own %TEMP% dir, then
// deletes it again (7za.exe included). Cold path: once HZMM exits, the
// registration must point at the persistent exe.
describe('portable build: nxm:// follows the running instance (gid 35)', () => {
  const quit = () => state.appOn.get('will-quit')()
  const status = () => state.handlers.get('nxm:get-status')({})
  const setEnabled = (on) => state.handlers.get('nxm:set-enabled')({}, on)

  beforeEach(() => {
    state.config.nxmHandlerEnabled = true
    state.nxmReg = RUNNING
  })

  it('startup re-registration (handler enabled) points at the running exe, not the launcher', () => {
    expect(startupProtoCalls).toEqual([['nxm', RUNNING, []]])
  })

  it('nxm:set-enabled(true) while running registers the running exe', async () => {
    state.nxmReg = null
    expect(await setEnabled(true)).toEqual({ enabled: true, isDefault: true })
    expect(setProto.mock.calls).toEqual([['nxm', RUNNING, []]])
    expect(state.nxmReg).toBe(RUNNING)
  })

  it('will-quit hands the registration to the persistent exe, once', () => {
    quit()
    expect(setProto.mock.calls).toEqual([['nxm', PORTABLE, []]])
    expect(state.nxmReg).toBe(PORTABLE)
    quit()
    expect(setProto).toHaveBeenCalledTimes(1)
  })

  it('a Windows session end (which skips will-quit) hands it off too', () => {
    state.windowOn.get('session-end')()
    expect(setProto.mock.calls).toEqual([['nxm', PORTABLE, []]])
    expect(state.nxmReg).toBe(PORTABLE)
  })

  it('the hand-off leaves alone a registration another manager took meanwhile', () => {
    state.nxmReg = OTHER_MANAGER
    quit()
    expect(setProto).not.toHaveBeenCalled()
    expect(state.nxmReg).toBe(OTHER_MANAGER)
  })

  it('the hand-off does nothing while the handler is disabled', () => {
    state.config.nxmHandlerEnabled = false
    quit()
    expect(setProto).not.toHaveBeenCalled()
    expect(state.nxmReg).toBe(RUNNING)
  })

  it('nxm:get-status counts either HZMM target as the default handler', async () => {
    expect((await status()).isDefault).toBe(true)
    state.nxmReg = PORTABLE
    expect((await status()).isDefault).toBe(true)
    state.nxmReg = OTHER_MANAGER
    expect((await status()).isDefault).toBe(false)
  })

  it('nxm:set-enabled(false) removes either HZMM registration, never another app\'s', async () => {
    expect(await setEnabled(false)).toEqual({ enabled: false, isDefault: false })
    expect(state.nxmReg).toBe(null)
    state.nxmReg = PORTABLE
    await setEnabled(false)
    expect(state.nxmReg).toBe(null)
    state.nxmReg = OTHER_MANAGER
    await setEnabled(false)
    expect(state.nxmReg).toBe(OTHER_MANAGER)
  })

  it('outside a portable build there is a single target and nothing to hand off', () => {
    delete process.env.PORTABLE_EXECUTABLE_FILE
    state.nxmReg = null
    nxm.registerNxmProtocol()
    expect(setProto.mock.calls).toEqual([['nxm', process.execPath, []]])
    nxm.handOffNxmRegistration()
    expect(setProto).toHaveBeenCalledTimes(1)
    expect(state.nxmReg).toBe(process.execPath)
  })
})

describe('updater batch carries non-ASCII paths through the environment (gid 43)', () => {
  let tmp

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-D-update-'))
  })

  it('generateUpdaterBatch output is 7-bit ASCII for non-ASCII paths', async () => {
    const { generateUpdaterBatch } = await import('../../src/main/ipc/app-update')
    const batch = generateUpdaterBatch(
      'C:\\Users\\Андрей\\AppData\\Roaming\\hzmm-manager\\hzmm-update.exe',
      'D:\\遊戲\\HZMM Manager.exe'
    )
    expect([...batch].every(c => c.charCodeAt(0) < 0x80)).toBe(true)
    expect(batch).toContain('copy /y "%HZMM_UPDATE_SRC%" "%HZMM_UPDATE_DST%"')
    expect(batch).toContain('start "" "%HZMM_UPDATE_DST%"')
  })

  it('app-update:install writes an ASCII batch and spawns it with both paths in env', async () => {
    try {
      state.configDir = path.join(tmp, 'Андрей', 'hzmm-manager')
      fs.mkdirSync(state.configDir, { recursive: true })
      const newExe = path.join(state.configDir, 'hzmm-update.exe')
      fs.writeFileSync(newExe, 'new')
      const current = path.join(tmp, '遊戲', 'HZMM Manager.exe')
      fs.mkdirSync(path.dirname(current))
      fs.writeFileSync(current, 'old')
      process.env.PORTABLE_EXECUTABLE_FILE = current
      state.verified = { path: newExe, hash: 'hash-1' }
      const spawn = vi.spyOn(electronMocks, 'spawn')
      vi.useFakeTimers()
      try {
        await state.handlers.get('app-update:install')({})
      } finally {
        vi.clearAllTimers()
        vi.useRealTimers()
      }
      const batPath = path.join(state.configDir, 'updater.bat')
      const bytes = fs.readFileSync(batPath)
      expect(bytes.every(b => b < 0x80)).toBe(true)
      expect(spawn).toHaveBeenCalledTimes(1)
      const [cmd, args, opts] = spawn.mock.calls[0]
      expect(cmd).toBe('cmd')
      expect(args).toEqual(['/c', batPath])
      expect(opts.env.HZMM_UPDATE_SRC).toBe(newExe)
      expect(opts.env.HZMM_UPDATE_DST).toBe(current)
      expect(opts.env.PATH).toBe(process.env.PATH)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('shell:open-external (gids 50, 51, 124, 145)', () => {
  const open = (url) => state.handlers.get('shell:open-external')({}, url)
  let openExternal

  beforeEach(() => {
    openExternal = vi.spyOn(electronMocks.shell, 'openExternal')
    openExternal.mockReset()
    openExternal.mockImplementation(() => Promise.resolve())
  })

  it.each([
    'mailto:author@example.com',
    'MAILTO:author@example.com',
    'mailto:a@b.c,d@e.f',
    'mailto:a@b.c?subject=Bug%20report&body=Hi',
  ])('hands the plain mailto link %s to the shell', async (url) => {
    await open(url)
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith(url)
  })

  it.each([
    'mailto:',
    'mailto:?subject=x',
    'mailto:not-an-address',
    'mailto:a@b.c?attach=C:\\Windows\\win.ini',
    'mailto:a@b.c#frag',
    'mailto:a%00b@c.d',
    'mailto:\\\\host\\share@x',
    'file:///C:/Windows/System32/calc.exe',
    'ms-msdt:/id PCWDiagnostic',
    'javascript:alert(1)',
  ])('still refuses %s', async (url) => {
    await open(url)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('still opens http(s) links', async () => {
    await open('https://www.nexusmods.com/humanitz/mods/1')
    expect(openExternal).toHaveBeenCalledWith('https://www.nexusmods.com/humanitz/mods/1')
  })

  it('a failing openExternal resolves the handler and is logged, not left unhandled', async () => {
    openExternal.mockImplementation(() => Promise.reject(new Error('no application is associated')))
    const warn = vi.spyOn(electronMocks.logger, 'warn')
    const ret = open('https://example.com/')
    expect(ret).toBeInstanceOf(Promise)
    await expect(ret).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no application is associated'))
  })
})

// Keep last: it re-imports the module graph.
describe('a forwarding second instance (gid 35)', () => {
  it('registers no will-quit hand-off, so it cannot move the running instance\'s nxm registration', async () => {
    const savedAppOn = state.appOn
    state.appOn = new Map()
    const lock = vi.spyOn(electronMocks.app, 'requestSingleInstanceLock').mockReturnValue(false)
    try {
      vi.resetModules()
      await import('../../src/main/index')
      expect(lock).toHaveBeenCalled()
      expect(state.appOn.has('second-instance')).toBe(false)
      expect(state.appOn.has('will-quit')).toBe(false)
    } finally {
      lock.mockRestore()
      state.appOn = savedAppOn
    }
  })
})
