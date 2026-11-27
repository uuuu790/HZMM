import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'

// Problem reports through the real IPC handlers: what the player reviews is
// what gets sent, unticked parts and personal bits never leave the machine,
// and every failure says so instead of pretending the report went out.

const API_KEY = 'nexus-api-key-SECRET-0123456789'
const HOME = os.homedir()
let USER = ''
try { USER = os.userInfo().username } catch { USER = process.env.USERNAME || '' }

const store = vi.hoisted(() => ({ data: {}, dir: '' }))
vi.mock('../../src/main/services/config-store', () => ({
  default: {
    get: (k, d = null) => (Object.hasOwn(store.data, k) ? store.data[k] : d),
    set: (k, v) => { store.data[k] = v },
    remove: (k) => { delete store.data[k] },
    getConfigDir: () => store.dir,
  },
}))

const logLines = vi.hoisted(() => ({ lines: [] }))
vi.mock('../../src/main/services/logger', () => ({
  default: {
    info: () => {}, warn: () => {}, error: () => {},
    getPath: () => '',
    readRecent: (n) => logLines.lines.slice(-n),
  },
}))

const net = vi.hoisted(() => ({ calls: [], respond: null }))
vi.mock('../../src/main/services/net-client', () => ({
  netRequest: async (url, opts) => {
    net.calls.push({ url, opts })
    return net.respond(url, opts)
  },
}))

// The Windows probe (PowerShell) answers with a fixed machine.
const probe = vi.hoisted(() => ({
  json: JSON.stringify({
    caption: 'Microsoft Windows 11 Pro', displayVersion: '24H2', build: '26100.4061',
    gpu: [{ name: 'NVIDIA GeForce RTX 4070', driver: '32.0.15.6094' }],
    av: [{ name: 'Bitdefender Antivirus', state: 266240 }, { name: 'Windows Defender', state: 393472 }],
  }),
  calls: 0,
}))
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    execFile: (file, args, opts, cb) => { probe.calls++; cb(null, probe.json, '') },
  }
})

const handlers = vi.hoisted(() => new Map())
const dialogs = vi.hoisted(() => ({ savePath: null, answers: [], shown: [], opened: [] }))
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '1.8.0',
    getSystemLocale: () => 'zh-TW',
    getPreferredSystemLanguages: () => ['zh-Hant-TW', 'en-US'],
    getLocale: () => 'zh-TW',
    getPath: () => os.tmpdir(),
  },
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
  dialog: {
    showSaveDialog: async () => (dialogs.savePath ? { canceled: false, filePath: dialogs.savePath } : { canceled: true }),
    showMessageBoxSync: (opts) => { dialogs.shown.push(opts); return dialogs.answers.shift() ?? opts.cancelId ?? 0 },
  },
  screen: {
    getPrimaryDisplay: () => ({ id: 1 }),
    getAllDisplays: () => [{ id: 1, bounds: { width: 1280, height: 720 }, scaleFactor: 1.5 }, { id: 2, bounds: { width: 1920, height: 1080 }, scaleFactor: 1 }],
  },
  shell: { openPath: async (p) => { dialogs.opened.push(p); return '' } },
  net: {},
}))

const { registerReportIpc, offerStartupFailureReport } = await import('../../src/main/ipc/report')

let root
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-report-'))
  store.dir = path.join(root, 'config')
  fs.mkdirSync(store.dir, { recursive: true })
  const paks = path.join(root, 'game', 'HumanitZ', 'Content', 'Paks')
  fs.mkdirSync(path.join(paks, '~mods'), { recursive: true })
  fs.writeFileSync(path.join(paks, '~mods', 'BetterTrade_P.pak'), Buffer.alloc(2048))
  fs.writeFileSync(path.join(paks, 'Old_P.pak.disabled'), Buffer.alloc(10))
  fs.writeFileSync(path.join(paks, 'pakchunk0-WindowsNoEditor.pak'), Buffer.alloc(10))
  process.env.HZMM_REPORT_ENDPOINT = 'https://inbox.test/v1/reports'
  registerReportIpc({ isDestroyed: () => false })
})

afterAll(() => {
  delete process.env.HZMM_REPORT_ENDPOINT
  fs.rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  store.data = { nexusApiKey: API_KEY, gamePath: path.join(root, 'game'), lang: 'zh-TW' }
  logLines.lines = [
    '[2026-11-27 10:00:00] [INFO] HZMM Manager started — version 1.8.0',
    `[2026-11-27 10:00:01] [INFO] Using game at ${HOME}\\Games\\HumanitZ`,
    `[2026-11-27 10:00:02] [WARN] request failed for key=${API_KEY}`,
  ]
  net.calls.length = 0
  net.respond = () => ({ statusCode: 201, headers: {}, bodyText: '{"id":"AB12-CD34"}' })
  dialogs.savePath = null
  dialogs.answers = []
  dialogs.shown = []
  dialogs.opened = []
})

const collect = (source = 'settings', context = null) => handlers.get('report:collect')({}, source, context)
const send = (...args) => handlers.get('report:send')({}, ...args)
const ALL = ['context', 'app', 'hw', 'disk', 'av', 'game', 'mods', 'log']

function sentPayload(call = net.calls.at(-1)) {
  return JSON.parse(zlib.gunzipSync(call.opts.body).toString('utf8'))
}

describe('report:collect', () => {
  it('gathers every part, in order, with the error first', async () => {
    const preview = await collect('error-toast', 'Install failed: boom')
    expect(typeof preview.token).toBe('string')
    expect(preview.sections.map(s => s.key)).toEqual(ALL)
    const text = Object.fromEntries(preview.sections.map(s => [s.key, s.text]))
    expect(text.context).toBe('Install failed: boom')
    expect(text.app).toContain('HZMM: 1.8.0')
    expect(text.app).toContain('Microsoft Windows 11 Pro 24H2 (build 26100.4061)')
    expect(text.hw).toContain('NVIDIA GeForce RTX 4070, driver 32.0.15.6094')
    expect(text.hw).toContain('1920x1080 at 150% (primary); 1920x1080 at 100%')
    expect(text.av).toContain('Bitdefender Antivirus: on, definitions up to date')
    expect(text.av).toContain('Windows Defender: off')
    expect(text.game).toContain('Paks/~mods')
    expect(text.mods).toContain('[on ] PAK    Paks/~mods/BetterTrade_P.pak (2.0 KB)')
    expect(text.mods).toContain('[off] PAK    Paks/Old_P.pak.disabled')
    expect(text.mods).not.toContain('pakchunk0')
    expect(text.log).toContain('HZMM Manager started')
  })

  it('leaves out the error part when nothing prompted the report', async () => {
    const preview = await collect('settings', '   ')
    expect(preview.sections.map(s => s.key)).toEqual(ALL.slice(1))
  })

  it('masks the profile folder, the user name and the API key everywhere', async () => {
    const preview = await collect('error-toast', `Install failed in ${HOME}\\Downloads`)
    const all = preview.sections.map(s => s.text).join('\n')
    expect(all).not.toContain(API_KEY)
    expect(all.toLowerCase()).not.toContain(HOME.toLowerCase())
    if (USER.length >= 3) expect(all).not.toMatch(new RegExp(`(?<![\\p{L}\\p{N}_])${USER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'iu'))
    expect(all).toContain('%USERPROFILE%\\Games\\HumanitZ')
    expect(all).toContain('key=<hidden>')
  })

  it('says what it could not read instead of failing the whole report', async () => {
    store.data.gamePath = undefined
    const preview = await collect()
    const text = Object.fromEntries(preview.sections.map(s => [s.key, s.text]))
    expect(text.game).toBe('Game folder: not set')
    expect(text.mods).toContain('no mods scanned')
  })
})

describe('report:send', () => {
  it('sends exactly the ticked parts and the note, gzipped, and returns the inbox id', async () => {
    const { token } = await collect('error-toast', 'Install failed: boom')
    const result = await send(token, ['context', 'app', 'log'], '  It crashed in ' + HOME + '\\Desktop  ', ' Jane ')
    expect(result).toEqual({ id: 'AB12-CD34' })
    expect(net.calls).toHaveLength(1)
    const call = net.calls[0]
    expect(call.url).toBe('https://inbox.test/v1/reports')
    expect(call.opts.method).toBe('POST')
    expect(call.opts.headers['Content-Type']).toBe('application/gzip')
    expect(JSON.parse(decodeURIComponent(call.opts.headers['X-HZMM-Summary']))).toEqual({ v: '1.8.0', src: 'error-toast', msg: 'Install failed: boom' })
    const payload = sentPayload(call)
    expect(Object.keys(payload.sections)).toEqual(['context', 'app', 'log'])
    expect(payload.note).toBe('It crashed in %USERPROFILE%\\Desktop')
    expect(payload.nexusName).toBe('Jane')
    expect(payload.version).toBe('1.8.0')
    expect(payload.source).toBe('error-toast')
    expect(JSON.stringify(payload)).not.toContain(API_KEY)
  })

  it('a renderer cannot claim the startup-error source', async () => {
    const { token } = await collect('startup-error', null)
    await send(token, ['app'], '', '')
    expect(sentPayload().source).toBe('settings')
  })

  it('a sent report cannot be sent twice', async () => {
    const { token } = await collect()
    await send(token, ['app'], '', '')
    await expect(send(token, ['app'], '', '')).rejects.toThrow(/expired/)
    await expect(send('no-such-token', ['app'], '', '')).rejects.toThrow(/expired/)
  })

  it('refuses an empty report without touching the network', async () => {
    const { token } = await collect()
    await expect(send(token, [], '   ', 'Jane')).rejects.toThrow(/Nothing to send/)
    expect(net.calls).toHaveLength(0)
  })

  it('reports the server refusing, and keeps the report for another try', async () => {
    const { token } = await collect()
    net.respond = () => ({ statusCode: 500, headers: {}, bodyText: 'oops' })
    await expect(send(token, ['app'], 'x', '')).rejects.toThrow(/HTTP 500/)
    net.respond = () => ({ statusCode: 429, headers: {}, bodyText: '' })
    await expect(send(token, ['app'], 'x', '')).rejects.toThrow(/busy/)
    net.respond = () => ({ statusCode: 201, headers: {}, bodyText: '{"id":"not an id"}' })
    await expect(send(token, ['app'], 'x', '')).rejects.toThrow(/HTTP 201/)
    net.respond = () => ({ statusCode: 201, headers: {}, bodyText: '{"id":"ZZ99-YY88"}' })
    await expect(send(token, ['app'], 'x', '')).resolves.toEqual({ id: 'ZZ99-YY88' })
  })
})

describe('report:save', () => {
  it('writes the same report as readable text, with a BOM for Notepad', async () => {
    const { token } = await collect('error-toast', 'Install failed: boom')
    dialogs.savePath = path.join(root, 'saved', 'report.txt')
    const saved = await handlers.get('report:save')({}, token, ['context', 'mods'], 'my note', '')
    expect(saved).toBe(dialogs.savePath)
    const raw = fs.readFileSync(saved, 'utf8')
    expect(raw.charCodeAt(0)).toBe(0xFEFF)
    expect(raw).toContain('== 錯誤內容 ==\nInstall failed: boom')
    expect(raw).toContain('== 已安裝的模組 ==')
    expect(raw).toContain('== 狀況說明 ==\nmy note')
    expect(raw).not.toContain('HZMM 記錄檔')
    expect(net.calls).toHaveLength(0)
  })

  it('returns null when the player cancels the dialog', async () => {
    const { token } = await collect()
    await expect(handlers.get('report:save')({}, token, ['app'], '', '')).resolves.toBeNull()
  })
})

describe('startup failure (native dialogs)', () => {
  const STACK = `Error: boom\n    at start (${HOME}\\AppData\\Local\\Temp\\x.js:1:1)`
  const reportFiles = () => {
    const dir = path.join(store.dir, 'reports')
    return fs.existsSync(dir) ? fs.readdirSync(dir) : []
  }

  it('closing the error box sends nothing', async () => {
    dialogs.answers = [1]
    await offerStartupFailureReport(STACK, 'C:\\log.txt')
    expect(dialogs.shown).toHaveLength(1)
    expect(dialogs.shown[0].buttons).toEqual(['傳送回報', '關閉'])
    expect(dialogs.shown[0].detail).toContain('Error: boom')
    expect(net.calls).toHaveLength(0)
  })

  it('"view contents" opens the whole report, then asks again', async () => {
    dialogs.answers = [0, 1, 2]
    await offerStartupFailureReport(STACK, '')
    const [, confirm, again] = dialogs.shown
    expect(confirm.buttons).toEqual(['傳送回報', '查看內容', '取消'])
    expect(confirm.detail).toContain('錯誤內容\nHZMM 與 Windows')
    expect(confirm.detail).toContain('按「查看內容」')
    expect(dialogs.opened).toHaveLength(1)
    const text = fs.readFileSync(dialogs.opened[0], 'utf8')
    expect(text).toContain('== 錯誤內容 ==\nError: boom')
    expect(text).toContain('== HZMM 記錄檔（最近 1000 行） ==')
    expect(text).not.toContain(API_KEY)
    expect(again.message).toBe(confirm.message)
    expect(net.calls).toHaveLength(0)
    fs.rmSync(path.join(store.dir, 'reports'), { recursive: true, force: true })
  })

  it('send: the report goes out and its file is cleaned up', async () => {
    dialogs.answers = [0, 0, 0]
    await offerStartupFailureReport(STACK, '')
    const done = dialogs.shown.at(-1)
    expect(done.message).toBe('回報已送出')
    expect(done.detail).toContain('AB12-CD34')
    const payload = sentPayload()
    expect(payload.source).toBe('startup-error')
    expect(payload.sections.context).toContain('%USERPROFILE%')
    expect(payload.sections.context.toLowerCase()).not.toContain(HOME.toLowerCase())
    expect(Object.keys(payload.sections)).toEqual(ALL)
    expect(reportFiles()).toEqual([])
  })

  it('cancel on the confirm box sends nothing', async () => {
    dialogs.answers = [0, 2]
    await offerStartupFailureReport(STACK, '')
    expect(net.calls).toHaveLength(0)
    expect(dialogs.shown).toHaveLength(2)
  })

  it('a failed send says why and where the saved report is', async () => {
    net.respond = () => ({ statusCode: 503, headers: {}, bodyText: '' })
    dialogs.answers = [0, 0, 0]
    await offerStartupFailureReport(STACK, '')
    const last = dialogs.shown.at(-1)
    expect(last.message).toBe('回報沒有送出')
    expect(last.detail).toContain('HTTP 503')
    const files = reportFiles()
    expect(files).toHaveLength(1)
    expect(last.detail).toContain(path.join(store.dir, 'reports', files[0]))
    fs.rmSync(path.join(store.dir, 'reports'), { recursive: true, force: true })
  })
})
