// Problem reports, the pure half: what a report holds, how personal bits are
// masked out of it, the exact JSON that is sent, and the readable text a
// player saves or previews. No Electron imports, so tests run these directly;
// collecting the data and sending it live in ipc/report.ts.
import type { ReportSectionKey, ReportSource } from '../ipc/types'

export type { ReportSectionKey, ReportSource }

export const REPORT_SECTION_KEYS = ['context', 'app', 'hw', 'disk', 'av', 'game', 'mods', 'log'] as const satisfies readonly ReportSectionKey[]

export interface ReportSection {
  key: ReportSectionKey
  text: string
}

export const REPORT_NOTE_MAX = 4000
export const REPORT_NEXUS_NAME_MAX = 64
/** Gzipped body cap; the inbox refuses anything larger. */
export const REPORT_MAX_BYTES = 512 * 1024

export interface MaskContext {
  homedir: string
  username: string
  hostname: string
  /** Exact strings that must never leave the machine (the Nexus API key). */
  secrets: string[]
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Masks the Windows user name, the computer name and any secret out of `text`:
 * the profile folder becomes %USERPROFILE%, other profile folders under
 * X:\Users\ become <user>, and the bare names become <user> / <computer>.
 */
export function maskPersonal(text: string, ctx: MaskContext): string {
  let out = text
  for (const secret of ctx.secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join('<hidden>')
  }
  if (ctx.homedir) {
    for (const variant of new Set([ctx.homedir, ctx.homedir.replace(/\\/g, '/')])) {
      out = out.replace(new RegExp(escapeRegExp(variant), 'gi'), '%USERPROFILE%')
    }
  }
  // Other accounts' folders and 8.3 short names (C:\Users\JOHNSM~1\…);
  // the shared Public / Default folders say nothing about the player.
  out = out.replace(/([A-Za-z]:[\\/]+Users[\\/]+)(?!(?:Public|Default|All Users)(?:[\\/]|$))[^\\/\r\n"'<>|:*?]+/gi, '$1<user>')
  // Bare names need some length to be told apart from ordinary words; two
  // CJK characters (a common user name) already are.
  const words: Array<[string, string]> = [[ctx.username, '<user>'], [ctx.hostname, '<computer>']]
  for (const [word, token] of words) {
    if (word && (word.length >= 3 || (word.length === 2 && hasNonAscii(word)))) {
      out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(word)}(?![\\p{L}\\p{N}_])`, 'giu'), token)
    }
  }
  return out
}

/** `label: value` lines; a missing value reads as "unknown". */
export function kvLines(rows: Array<[string, string | number | null | undefined]>): string {
  return rows.map(([label, value]) => `${label}: ${value === null || value === undefined || value === '' ? 'unknown' : value}`).join('\n')
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

export const hasNonAscii = (s: string): boolean => /[^\x20-\x7e]/.test(s)

export interface FolderEnv {
  home: string
  temp: string
  programFiles: string[]
  windir: string
  oneDrive: string[]
}

const norm = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
const under = (child: string, parent: string): boolean => {
  if (!parent) return false
  const c = norm(child)
  const p = norm(parent)
  return c === p || c.startsWith(p + '\\')
}

/** What kind of folder `exePath` sits in — the kind, never the path itself. */
export function folderKind(exePath: string, env: FolderEnv): string {
  const p = exePath.replace(/\//g, '\\')
  if (p.startsWith('\\\\')) return 'a network share'
  if (under(p, env.temp)) return 'the Temp folder (often: run straight from inside a zip)'
  if (env.oneDrive.some(d => under(p, d))) return 'a OneDrive folder'
  for (const [sub, label] of [['Downloads', 'Downloads'], ['Desktop', 'Desktop'], ['Documents', 'Documents']]) {
    if (under(p, `${env.home}\\${sub}`)) return `the ${label} folder`
  }
  if (under(p, env.home)) return 'the user profile folder'
  if (env.programFiles.some(d => under(p, d))) return 'Program Files'
  if (under(p, env.windir)) return 'the Windows folder'
  const parts = p.split('\\').filter(Boolean)
  const drive = /^[A-Za-z]:$/.test(parts[0] ?? '') ? parts[0].toUpperCase() : null
  if (drive && parts.length <= 2) return `the root of drive ${drive}`
  return drive ? `a folder on drive ${drive}` : 'another folder'
}

/** Windows Security Center productState: real-time protection and definitions. */
export function describeAvState(state: unknown): string {
  if (typeof state !== 'number' || !Number.isFinite(state)) return 'state unknown'
  const on = ((state >> 12) & 0x1) === 1
  const stale = ((state >> 4) & 0x1) === 1
  return `${on ? 'on' : 'off'}, definitions ${stale ? 'out of date' : 'up to date'} (0x${state.toString(16).padStart(6, '0')})`
}

export interface ReportPayload {
  format: 1
  app: 'HZMM Manager'
  version: string
  createdAt: string
  source: ReportSource
  language: string
  /** What the player wrote, masked like everything else. */
  note: string
  /** Optional, so the author can answer on Nexus; sent as typed. */
  nexusName: string
  sections: Partial<Record<ReportSectionKey, string>>
}

export interface PayloadInput {
  version: string
  createdAt: string
  source: ReportSource
  language: string
  sections: ReportSection[]
  include: unknown
  note: unknown
  nexusName: unknown
  mask: MaskContext
}

/** The report exactly as it is sent: the sections the player kept ticked, plus their note. */
export function buildPayload(input: PayloadInput): ReportPayload {
  const wanted = new Set(Array.isArray(input.include) ? input.include.filter((k): k is string => typeof k === 'string') : [])
  const sections: Partial<Record<ReportSectionKey, string>> = {}
  for (const section of input.sections) {
    if (wanted.has(section.key)) sections[section.key] = section.text
  }
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, REPORT_NOTE_MAX) : ''
  const nexusName = typeof input.nexusName === 'string' ? input.nexusName.trim().slice(0, REPORT_NEXUS_NAME_MAX) : ''
  return {
    format: 1,
    app: 'HZMM Manager',
    version: input.version,
    createdAt: input.createdAt,
    source: input.source,
    language: input.language,
    note: maskPersonal(note, input.mask),
    nexusName,
    sections,
  }
}

export const isEmptyPayload = (p: ReportPayload): boolean => !p.note && Object.keys(p.sections).length === 0

/** One line for the author's notification: version, source, the first line of the error or note. */
export function reportSummary(p: ReportPayload): string {
  const first = (p.sections.context || p.note || '').split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? ''
  return encodeURIComponent(JSON.stringify({ v: p.version, src: p.source, msg: first.slice(0, 160) }))
}

/** The report as readable text — what a player saves, or previews before a startup-error send. */
export function renderReportText(p: ReportPayload, titles: Record<ReportSectionKey, string> & { note: string; nexusName: string }): string {
  const out = [
    'HZMM Manager problem report',
    kvLines([['Version', p.version], ['Created', p.createdAt], ['Source', p.source], ['Language', p.language]]),
  ]
  if (p.note) out.push(`== ${titles.note} ==\n${p.note}`)
  if (p.nexusName) out.push(`${titles.nexusName}: ${p.nexusName}`)
  for (const key of REPORT_SECTION_KEYS) {
    const text = p.sections[key]
    if (text !== undefined) out.push(`== ${titles[key]} ==\n${text}`)
  }
  return out.join('\n\n') + '\n'
}
