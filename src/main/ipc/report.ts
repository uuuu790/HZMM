// Problem reports: gather what the player is about to send (system, game, mods,
// the recent log), hold it while they review it, then send exactly that to the
// author's report inbox — or save it as a file. Nothing is collected or sent
// unless the player opens a report and presses Send; the startup error dialog
// offers the same flow through native dialogs when no window could open.
import { app, dialog, ipcMain, screen, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { execFile } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'
import configStore from '../services/config-store'
import logger from '../services/logger'
import { netRequest } from '../services/net-client'
import { mainText, type MainText } from '../services/main-text'
import { getGameVersionCached, isSteamGame, listPaksDirs } from '../services/steam-detector'
import {
  REPORT_MAX_BYTES,
  REPORT_SECTION_KEYS,
  buildPayload,
  describeAvState,
  folderKind,
  formatSize,
  hasNonAscii,
  isEmptyPayload,
  kvLines,
  maskPersonal,
  renderReportText,
  reportSummary,
  type MaskContext,
  type ReportPayload,
  type ReportSection,
} from '../services/report-format'
import { scanMods } from './mods-scan'
import { checkUe4ssStatus } from './ue4ss'
import { currentLocale, detectLocale } from './locale'
import type { ReportPreview, ReportSectionKey, ReportSource } from './types'

// The author's report inbox (report-inbox/worker). HZMM_REPORT_ENDPOINT points
// a build at a local test inbox instead.
const REPORT_ENDPOINT = 'https://hzmm-reports.uuuu790.workers.dev/v1/reports'
const reportEndpoint = (): string => process.env.HZMM_REPORT_ENDPOINT || REPORT_ENDPOINT

const LOG_LINES = 1000
const CONTEXT_MAX = 4000
const PROBE_TIMEOUT_MS = 15_000
const SEND_TIMEOUT_MS = 30_000

interface Collected {
  createdAt: string
  source: ReportSource
  language: string
  sections: ReportSection[]
}

// Reports collected but not yet sent, by token. A handful at most: one per
// open report dialog.
const pending = new Map<string, Collected>()
const PENDING_MAX = 5

// The UI language; when the config can't be read (a startup failure), the
// Windows language HZMM would pick by itself.
function safeLocale(): string {
  try { return currentLocale() } catch { /* config unreadable */ }
  try { return detectLocale() } catch { return 'en' }
}

function safeText(): MainText {
  return mainText(safeLocale())
}

/** Local time with its UTC offset, e.g. 2026-11-27T12:04:05+08:00. */
function localIsoTime(d = new Date()): string {
  const pad = (n: number): string => String(Math.abs(n)).padStart(2, '0')
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
}

function maskContext(): MaskContext {
  let username = ''
  try { username = os.userInfo().username } catch { username = process.env.USERNAME || '' }
  let secret = ''
  try { secret = String(configStore.get('nexusApiKey', '') || '') } catch { /* config unreadable */ }
  return { homedir: os.homedir(), username, hostname: os.hostname(), secrets: [secret] }
}

// ---------------------------------------------------------------------------
// Collecting
// ---------------------------------------------------------------------------

interface WindowsProbe {
  caption?: string
  displayVersion?: string
  build?: string
  gpu?: unknown
  av?: unknown
}

// One PowerShell call for what Node can't see: the Windows edition and
// release, the display adapters, and the antivirus registered with Windows
// Security Center. Read-only CIM / registry queries; output forced to UTF-8
// so non-English product names survive.
const PROBE_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$cv = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'",
  '$os = Get-CimInstance -ClassName Win32_OperatingSystem',
  '$gpu = @(Get-CimInstance -ClassName Win32_VideoController | ForEach-Object { [pscustomobject]@{ name = $_.Name; driver = $_.DriverVersion } })',
  '$av = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | ForEach-Object { [pscustomobject]@{ name = $_.displayName; state = $_.productState } })',
  '[pscustomobject]@{ caption = $os.Caption; displayVersion = $cv.DisplayVersion; build = "$($cv.CurrentBuild).$($cv.UBR)"; gpu = $gpu; av = $av } | ConvertTo-Json -Compress -Depth 4',
].join('; ')

function probeWindows(): Promise<WindowsProbe | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PROBE_SCRIPT],
      { windowsHide: true, timeout: PROBE_TIMEOUT_MS, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          logger.warn(`Report: system query failed: ${err.message}`)
          resolve(null)
          return
        }
        try { resolve(JSON.parse(String(stdout).trim()) as WindowsProbe) } catch { resolve(null) }
      })
  })
}

const asList = (v: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []) as Array<Record<string, unknown>>
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

function buildType(): string {
  if (process.env.PORTABLE_EXECUTABLE_FILE) return 'portable'
  return app.isPackaged ? 'installed' : 'development'
}

function appSection(probe: WindowsProbe | null): string {
  const windows = probe?.caption
    ? `${probe.caption}${probe.displayVersion ? ` ${probe.displayVersion}` : ''} (build ${probe.build || os.release()})`
    : `${os.version()} (${os.release()})`
  let preferred = ''
  try { preferred = app.getPreferredSystemLanguages().join(', ') } catch { /* older runtime */ }
  return kvLines([
    ['HZMM', `${app.getVersion()} (${buildType()})`],
    ['Electron', `${process.versions.electron} / Chromium ${process.versions.chrome}`],
    ['Windows', `${windows}, ${os.arch()}`],
    ['Windows language', `${app.getSystemLocale()}${preferred ? ` (preferred: ${preferred})` : ''}`],
    ['HZMM language', safeLocale()],
  ])
}

function hwSection(probe: WindowsProbe | null): string {
  const cpus = os.cpus()
  const gpus = asList(probe?.gpu)
    .map(g => [str(g.name), str(g.driver) ? `driver ${str(g.driver)}` : null].filter(Boolean).join(', '))
    .filter(Boolean)
  let displays = ''
  try {
    const primary = screen.getPrimaryDisplay().id
    displays = screen.getAllDisplays().map(d => {
      const w = Math.round(d.bounds.width * d.scaleFactor)
      const h = Math.round(d.bounds.height * d.scaleFactor)
      return `${w}x${h} at ${Math.round(d.scaleFactor * 100)}%${d.id === primary ? ' (primary)' : ''}`
    }).join('; ')
  } catch { /* no display info */ }
  return kvLines([
    ['CPU', cpus.length ? `${cpus[0].model.trim()} (${cpus.length} threads)` : null],
    ['GPU', gpus.join('; ') || null],
    ['RAM', `${formatSize(os.totalmem())} total, ${formatSize(os.freemem())} free`],
    ['Displays', displays || null],
  ])
}

function folderEnv(): Parameters<typeof folderKind>[1] {
  const home = os.homedir()
  const env = process.env
  return {
    home,
    temp: os.tmpdir(),
    programFiles: [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter((p): p is string => !!p),
    windir: env.SystemRoot || env.windir || 'C:\\Windows',
    oneDrive: [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial].filter((p): p is string => !!p),
  }
}

function diskSection(): string {
  const temp = os.tmpdir()
  let tempSpace: string | null = null
  try {
    const s = fs.statfsSync(temp)
    tempSpace = `${formatSize(s.bavail * s.bsize)} free of ${formatSize(s.blocks * s.bsize)}`
  } catch { /* unreadable */ }
  // The portable launcher the player double-clicked; otherwise the running exe.
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
  return kvLines([
    ['Temp folder', `drive ${path.parse(temp).root.replace(/\\$/, '') || 'unknown'}, ${tempSpace ?? 'free space unknown'}`],
    ['Temp path has non-English characters', hasNonAscii(temp) ? 'yes' : 'no'],
    ['HZMM is in', folderKind(exe, folderEnv())],
    ['HZMM path has non-English characters', hasNonAscii(exe) ? 'yes' : 'no'],
  ])
}

function avSection(probe: WindowsProbe | null): string {
  if (!probe) return 'Could not query Windows Security Center.'
  const products = asList(probe.av)
    .map(a => str(a.name) ? `${str(a.name)}: ${describeAvState(a.state)}` : null)
    .filter(Boolean)
  return products.length ? products.join('\n') : 'None registered with Windows Security Center.'
}

function gameFolderKind(gamePath: string): string {
  const p = gamePath.replace(/\//g, '\\').toLowerCase()
  const drive = /^[a-z]:/.test(p) ? p.slice(0, 2).toUpperCase() : null
  if (p.includes('\\steamapps\\common\\')) {
    if (p.includes('\\program files (x86)\\steam\\')) return "Steam's default library (Program Files (x86))"
    return `a Steam library on drive ${drive ?? '?'}`
  }
  return `not a Steam library${drive ? ` (drive ${drive})` : ''}`
}

function gameSection(): string {
  const gamePath = configStore.get('gamePath')
  if (!gamePath) return 'Game folder: not set'
  const version = getGameVersionCached()
  let versionText: string | null = null
  if (version && 'fileVersion' in version) versionText = `exe version ${version.fileVersion}`
  else if (version) {
    versionText = [version.versionName, version.buildId ? `build ${version.buildId}` : null, version.lastUpdated ? `updated ${version.lastUpdated}` : null]
      .filter(Boolean).join(', ') || null
  }
  let paksDirs: string | null = null
  try {
    paksDirs = listPaksDirs(gamePath).map(d => (d.rel ? `Paks/${d.rel}` : 'Paks')).join(', ') || 'none found'
  } catch { /* unreadable */ }
  let ue4ss: string | null = null
  try {
    const s = checkUe4ssStatus()
    ue4ss = s.status === 'uninstalled'
      ? 'not installed'
      : `installed${s.version ? `, ${s.version}` : ''}${s.structure ? ` (${s.structure} layout)` : ''}`
  } catch { /* unreadable */ }
  return kvLines([
    ['Game folder', `${gameFolderKind(gamePath)}${isSteamGame(gamePath) ? '' : ', no Steam manifest'}`],
    ['Game folder has non-English characters', hasNonAscii(gamePath) ? 'yes' : 'no'],
    ['Game version', versionText],
    ['Mod folders under Content', paksDirs],
    ['UE4SS', ue4ss],
  ])
}

function modsSection(): string {
  const gamePath = configStore.get('gamePath')
  if (!gamePath) return 'Game folder not set — no mods scanned.'
  const mods = scanMods()
  const dirs = listPaksDirs(gamePath)
  const relOf = (file: string): string => {
    const dir = path.resolve(path.dirname(file)).toLowerCase()
    const hit = dirs.find(d => path.resolve(d.dir).toLowerCase() === dir)
    return hit ? (hit.rel ? `Paks/${hit.rel}` : 'Paks') : '?'
  }
  const paks = mods.filter(m => m.type === 'PAK')
  const lua = mods.filter(m => m.type === 'UE4SS')
  const lines = [
    `${paks.length} PAK mods (${paks.filter(m => m.enabled).length} on), ${lua.length} UE4SS mods (${lua.filter(m => m.enabled).length} on)`,
    ...paks.map(m => `[${m.enabled ? 'on ' : 'off'}] PAK    ${relOf(m.path)}/${m.filename} (${formatSize(m.size)})`),
    ...lua.map(m => `[${m.enabled ? 'on ' : 'off'}] UE4SS  ${m.filename}${m.subtype ? ` (${m.subtype})` : ''}${m.hybrid ? ', with PAK' : ''}`),
  ]
  return lines.join('\n')
}

function logSection(): string {
  const lines = logger.readRecent(LOG_LINES)
  return lines.length ? lines.join('\n') : '(the log is empty)'
}

function attempt(fn: () => string): string {
  try { return fn() } catch (err) { return `(could not read this: ${(err as Error).message})` }
}

/** Everything a report can hold, masked, ready for review. */
async function collectSections(context: string | null): Promise<ReportSection[]> {
  const probe = await probeWindows()
  const raw: Record<ReportSectionKey, string | null> = {
    context,
    app: attempt(() => appSection(probe)),
    hw: attempt(() => hwSection(probe)),
    disk: attempt(diskSection),
    av: attempt(() => avSection(probe)),
    game: attempt(gameSection),
    mods: attempt(modsSection),
    log: attempt(logSection),
  }
  const mask = maskContext()
  const sections: ReportSection[] = []
  for (const key of REPORT_SECTION_KEYS) {
    const text = raw[key]
    if (text !== null) sections.push({ key, text: maskPersonal(text, mask) })
  }
  return sections
}

async function collect(source: ReportSource, context: string | null): Promise<{ token: string; report: Collected }> {
  const report: Collected = {
    createdAt: localIsoTime(),
    source,
    language: safeLocale(),
    sections: await collectSections(context),
  }
  const token = crypto.randomUUID()
  pending.set(token, report)
  while (pending.size > PENDING_MAX) pending.delete(pending.keys().next().value as string)
  return { token, report }
}

// ---------------------------------------------------------------------------
// Sending and saving
// ---------------------------------------------------------------------------

function payloadFor(report: Collected, include: unknown, note: unknown, nexusName: unknown): ReportPayload {
  return buildPayload({
    version: app.getVersion(),
    createdAt: report.createdAt,
    source: report.source,
    language: report.language,
    sections: report.sections,
    include,
    note,
    nexusName,
    mask: maskContext(),
  })
}

const REPORT_ID_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/

/** Sends the payload; resolves with the inbox's report id. */
async function sendPayload(payload: ReportPayload): Promise<string> {
  const body = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 })
  if (body.length > REPORT_MAX_BYTES) throw new Error(`The report is too large to send (${formatSize(body.length)})`)
  const endpoint = reportEndpoint()
  const res = await netRequest(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/gzip',
      'X-HZMM-Summary': reportSummary(payload),
    },
    body,
    timeoutMs: SEND_TIMEOUT_MS,
    timeoutMessage: 'The report server did not answer in time',
  })
  let id: unknown = null
  try { id = (JSON.parse(res.bodyText) as { id?: unknown }).id } catch { /* not JSON */ }
  if (res.statusCode === 201 && typeof id === 'string' && REPORT_ID_RE.test(id)) {
    logger.info(`Problem report sent: ${id} (${formatSize(body.length)})`)
    return id
  }
  logger.warn(`Problem report refused: HTTP ${res.statusCode} from ${endpoint}`)
  throw new Error(res.statusCode === 429
    ? 'The report server is busy right now — try again later'
    : `The report server answered HTTP ${res.statusCode}`)
}

function sectionTitles(text: MainText): Parameters<typeof renderReportText>[1] {
  return { ...text.reportSections, note: text.reportNoteTitle, nexusName: text.reportNexusName }
}

function fileStamp(createdAt: string): string {
  return createdAt.slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
}

/** UTF-8 with a BOM so Notepad shows non-English text correctly. */
function writeReportFile(filePath: string, payload: ReportPayload): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, '\uFEFF' + renderReportText(payload, sectionTitles(safeText())), 'utf-8')
}

function reportsDir(): string {
  try { return path.join(configStore.getConfigDir(), 'reports') } catch { return path.join(os.tmpdir(), 'hzmm-reports') }
}

function pendingReport(token: unknown): Collected {
  const report = typeof token === 'string' ? pending.get(token) : undefined
  if (!report) throw new Error('This report has expired — close it and open a new one')
  return report
}

function registerReportIpc(mainWindow: BrowserWindow): void {
  ipcMain.handle('report:collect', async (_e: IpcMainInvokeEvent, source: unknown, context: unknown): Promise<ReportPreview> => {
    // The renderer opens reports from Settings or an error message; the
    // startup-error flow never goes through here.
    const src: ReportSource = source === 'error-toast' ? 'error-toast' : 'settings'
    const ctx = typeof context === 'string' && context.trim() ? context.trim().slice(0, CONTEXT_MAX) : null
    const { token, report } = await collect(src, ctx)
    return { token, sections: report.sections.map(s => ({ key: s.key, text: s.text })) }
  })

  ipcMain.handle('report:send', async (_e: IpcMainInvokeEvent, token: unknown, include: unknown, note: unknown, nexusName: unknown): Promise<{ id: string }> => {
    const report = pendingReport(token)
    const payload = payloadFor(report, include, note, nexusName)
    if (isEmptyPayload(payload)) throw new Error('Nothing to send: tick at least one part or write what happened')
    const id = await sendPayload(payload)
    pending.delete(token as string)
    return { id }
  })

  ipcMain.handle('report:save', async (_e: IpcMainInvokeEvent, token: unknown, include: unknown, note: unknown, nexusName: unknown): Promise<string | null> => {
    const report = pendingReport(token)
    const payload = payloadFor(report, include, note, nexusName)
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
    const options = {
      defaultPath: path.join(app.getPath('desktop'), `HZMM-report-${fileStamp(report.createdAt)}.txt`),
      filters: [{ name: 'Text', extensions: ['txt'] }],
    }
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    writeReportFile(result.filePath, payload)
    logger.info('Problem report saved to a file')
    return result.filePath
  })
}

// ---------------------------------------------------------------------------
// Startup failure: native dialogs only (no window may exist)
// ---------------------------------------------------------------------------

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k] : m))

/**
 * Tells the player HZMM couldn't start and offers to send a report about it.
 * Resolves once they are done; the caller then quits.
 */
async function offerStartupFailureReport(detail: string, logPath: string): Promise<void> {
  const text = safeText()
  const choice = dialog.showMessageBoxSync({
    type: 'error',
    title: 'HZMM Manager',
    message: text.startupFailed,
    detail: [detail, logPath].filter(Boolean).join('\n\n'),
    buttons: [text.reportSendButton, text.closeButton],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  })
  if (choice !== 0) return

  const { report } = await collect('startup-error', detail.slice(0, CONTEXT_MAX))
  const payload = payloadFor(report, REPORT_SECTION_KEYS, '', '')
  const file = path.join(reportsDir(), `HZMM-startup-report-${fileStamp(report.createdAt)}.txt`)
  let fileWritten = false
  try { writeReportFile(file, payload); fileWritten = true } catch (err) { logger.warn(`Could not write the report file: ${(err as Error).message}`) }

  const parts = REPORT_SECTION_KEYS.filter(k => payload.sections[k] !== undefined).map(k => text.reportSections[k]).join('\n')
  const size = formatSize(Buffer.byteLength(JSON.stringify(payload), 'utf8'))
  for (;;) {
    const buttons = fileWritten ? [text.reportSendButton, text.reportViewButton, text.reportCancelButton] : [text.reportSendButton, text.reportCancelButton]
    const pick = dialog.showMessageBoxSync({
      type: 'question',
      title: 'HZMM Manager',
      message: text.reportConfirm,
      detail: [fill(text.reportConfirmDetail, { parts, size }), fileWritten ? text.reportViewHint : ''].filter(Boolean).join('\n\n'),
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
      noLink: true,
    })
    if (pick === buttons.length - 1) return
    if (fileWritten && pick === 1) {
      await shell.openPath(file)
      continue
    }
    break
  }

  try {
    const id = await sendPayload(payload)
    if (fileWritten) fs.rmSync(file, { force: true })
    dialog.showMessageBoxSync({ type: 'info', title: 'HZMM Manager', message: text.reportSent, detail: fill(text.reportSentDetail, { id }), buttons: [text.closeButton], noLink: true })
  } catch (err) {
    const where = fileWritten ? fill(text.reportSavedHint, { path: file }) : ''
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'HZMM Manager',
      message: text.reportNotSent,
      detail: [(err as Error).message, where].filter(Boolean).join('\n\n'),
      buttons: [text.closeButton],
      noLink: true,
    })
  }
}

export { registerReportIpc, offerStartupFailureReport }
