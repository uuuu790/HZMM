import { describe, it, expect } from 'vitest'
import {
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
} from '../../src/main/services/report-format'

// The pure half of problem reports: personal bits never leave the machine,
// only what the player kept ticked is sent, and the saved text matches it.

const MASK = {
  homedir: 'C:\\Users\\Jane Doe',
  username: 'Jane Doe',
  hostname: 'JANE-PC',
  secrets: ['nexus-api-key-1234567890'],
}

describe('maskPersonal', () => {
  it('turns the profile folder into %USERPROFILE%, in either slash style and any case', () => {
    expect(maskPersonal('C:\\Users\\Jane Doe\\AppData\\Local\\Temp\\ns1.tmp', MASK)).toBe('%USERPROFILE%\\AppData\\Local\\Temp\\ns1.tmp')
    expect(maskPersonal('c:/users/jane doe/Downloads/HZMM Manager.exe', MASK)).toBe('%USERPROFILE%/Downloads/HZMM Manager.exe')
  })

  it('masks other profile folders and 8.3 short names, but not Public', () => {
    expect(maskPersonal('C:\\Users\\JANEDO~1\\AppData', MASK)).toBe('C:\\Users\\<user>\\AppData')
    expect(maskPersonal('D:\\Users\\someone\\x', MASK)).toBe('D:\\Users\\<user>\\x')
    expect(maskPersonal('C:\\Users\\Public\\Documents', MASK)).toBe('C:\\Users\\Public\\Documents')
  })

  it('masks the bare user and computer names, whole words only', () => {
    expect(maskPersonal('signed in as Jane Doe on JANE-PC', MASK)).toBe('signed in as <user> on <computer>')
    expect(maskPersonal('JANE-PCX stays', MASK)).toBe('JANE-PCX stays')
  })

  it('masks a non-English user name', () => {
    const mask = { homedir: 'C:\\Users\\小明', username: '小明', hostname: '', secrets: [] }
    expect(maskPersonal('C:\\Users\\小明\\Desktop and 小明', mask)).toBe('%USERPROFILE%\\Desktop and <user>')
  })

  it('never lets a secret through', () => {
    expect(maskPersonal('apikey=nexus-api-key-1234567890&x=1', MASK)).toBe('apikey=<hidden>&x=1')
  })

  it('leaves short names alone (too likely to hit ordinary words)', () => {
    const mask = { homedir: 'C:\\Users\\al', username: 'al', hostname: 'pc', secrets: ['short'] }
    expect(maskPersonal('total pc short', mask)).toBe('total pc short')
  })
})

describe('folderKind', () => {
  const env = {
    home: 'C:\\Users\\Jane',
    temp: 'C:\\Users\\Jane\\AppData\\Local\\Temp',
    programFiles: ['C:\\Program Files', 'C:\\Program Files (x86)'],
    windir: 'C:\\Windows',
    oneDrive: ['C:\\Users\\Jane\\OneDrive'],
  }
  it.each([
    ['C:\\Users\\Jane\\Downloads\\HZMM Manager.exe', 'the Downloads folder'],
    ['C:\\Users\\Jane\\Desktop\\HZMM\\HZMM Manager.exe', 'the Desktop folder'],
    ['C:\\Users\\Jane\\OneDrive\\Desktop\\HZMM Manager.exe', 'a OneDrive folder'],
    ['C:\\Users\\Jane\\AppData\\Local\\Temp\\Temp1_HZMM.zip\\HZMM Manager.exe', 'the Temp folder (often: run straight from inside a zip)'],
    ['C:\\Users\\Jane\\Games\\HZMM Manager.exe', 'the user profile folder'],
    ['C:\\Program Files\\HZMM\\HZMM Manager.exe', 'Program Files'],
    ['D:\\HZMM Manager.exe', 'the root of drive D:'],
    ['e:\\Games\\HZMM\\HZMM Manager.exe', 'a folder on drive E:'],
    ['\\\\nas\\share\\HZMM Manager.exe', 'a network share'],
  ])('%s → %s', (p, kind) => {
    expect(folderKind(p, env)).toBe(kind)
  })

  it('does not mistake a sibling folder for the profile folder', () => {
    expect(folderKind('C:\\Users\\Janet\\Downloads\\x.exe', env)).toBe('a folder on drive C:')
  })
})

describe('small formatters', () => {
  it('describeAvState decodes real-time protection and definitions', () => {
    expect(describeAvState(397568)).toBe('on, definitions up to date (0x061100)')
    expect(describeAvState(393472)).toBe('off, definitions up to date (0x060100)')
    expect(describeAvState(266256)).toBe('on, definitions out of date (0x041010)')
    expect(describeAvState(undefined)).toBe('state unknown')
  })

  it('kvLines writes unknown for missing values', () => {
    expect(kvLines([['A', 1], ['B', null], ['C', '']])).toBe('A: 1\nB: unknown\nC: unknown')
  })

  it('formatSize and hasNonAscii', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2.0 KB')
    expect(formatSize(5 * 1024 ** 3)).toBe('5.0 GB')
    expect(hasNonAscii('C:\\Users\\Jane')).toBe(false)
    expect(hasNonAscii('C:\\Users\\小明')).toBe(true)
  })
})

describe('buildPayload', () => {
  const sections = REPORT_SECTION_KEYS.map(key => ({ key, text: `${key} text` }))
  const base = { version: '1.8.0', createdAt: '2026-11-27T12:00:00+08:00', source: 'settings', language: 'zh-TW', sections, mask: MASK }

  it('keeps only the sections the player left ticked', () => {
    const p = buildPayload({ ...base, include: ['app', 'log', 'bogus'], note: '', nexusName: '' })
    expect(Object.keys(p.sections).sort()).toEqual(['app', 'log'])
    expect(p.sections.app).toBe('app text')
  })

  it('trims and masks the note, trims the Nexus name, and caps both', () => {
    const p = buildPayload({ ...base, include: [], note: '  it broke in C:\\Users\\Jane Doe\\Desktop  ', nexusName: '  Jane_Nexus  ' })
    expect(p.note).toBe('it broke in %USERPROFILE%\\Desktop')
    expect(p.nexusName).toBe('Jane_Nexus')
    const long = buildPayload({ ...base, include: [], note: 'x'.repeat(5000), nexusName: 'n'.repeat(100) })
    expect(long.note).toHaveLength(4000)
    expect(long.nexusName).toHaveLength(64)
  })

  it('treats junk arguments as nothing', () => {
    const p = buildPayload({ ...base, include: 'app', note: 42, nexusName: {} })
    expect(p.sections).toEqual({})
    expect(p.note).toBe('')
    expect(p.nexusName).toBe('')
    expect(isEmptyPayload(p)).toBe(true)
  })

  it('summary carries the version, source and first line of the error', () => {
    const p = buildPayload({ ...base, include: ['context'], note: 'my note', nexusName: '' })
    p.sections.context = '\n  Install failed: boom\nstack…'
    expect(JSON.parse(decodeURIComponent(reportSummary(p)))).toEqual({ v: '1.8.0', src: 'settings', msg: 'Install failed: boom' })
    delete p.sections.context
    expect(JSON.parse(decodeURIComponent(reportSummary(p))).msg).toBe('my note')
  })

  it('the readable text holds exactly what is sent', () => {
    const p = buildPayload({ ...base, include: ['context', 'mods'], note: 'what I saw', nexusName: 'Jane' })
    const titles = Object.fromEntries(REPORT_SECTION_KEYS.map(k => [k, `T-${k}`]))
    const text = renderReportText(p, { ...titles, note: 'Note', nexusName: 'Nexus' })
    expect(text).toContain('== Note ==\nwhat I saw')
    expect(text).toContain('Nexus: Jane')
    expect(text).toContain('== T-context ==\ncontext text')
    expect(text).toContain('== T-mods ==\nmods text')
    expect(text).not.toContain('T-log')
    expect(text.indexOf('T-context')).toBeLessThan(text.indexOf('T-mods'))
  })
})
