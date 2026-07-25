import { describe, it, expect, beforeEach } from 'vitest'
import { shell } from 'electron'
import { isAllowedExternalUrl, openExternalSafe } from '../../src/main/services/external-link.js'

// REMOTE-CODE-EXECUTION REGRESSION.
//
// shell.openExternal is ShellExecute: a `file:` URL runs the target, and a UNC
// path fetches and runs it over SMB. setWindowOpenHandler used to hand it
// `details.url` unvalidated, and that path is reachable from untrusted mod
// content — Chromium dispatches `auxclick` for a middle-click, so the renderer's
// own anchor guards never see it and the click becomes a new-window request.
describe('isAllowedExternalUrl', () => {
  it('allows http and https', () => {
    expect(isAllowedExternalUrl('https://www.nexusmods.com/humanitz/mods/82')).toBe(true)
    expect(isAllowedExternalUrl('http://example.com/')).toBe(true)
  })

  const blocked = [
    'file:///C:/Windows/System32/calc.exe',
    'file://attacker.example.com/share/payload.exe',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'smb://attacker.example.com/share/payload.exe',
    'ms-msdt:/id PCWDiagnostic',
    'search-ms:query=x',
    'vbscript:msgbox(1)',
    'shell:startup',
    '\\\\attacker.example.com\\share\\payload.exe',
    '',
    null,
    undefined,
    42,
    {},
  ]

  for (const url of blocked) {
    it(`blocks ${JSON.stringify(url)}`, () => {
      expect(isAllowedExternalUrl(url)).toBe(false)
    })
  }
})

describe('openExternalSafe', () => {
  beforeEach(() => {
    shell.calls.length = 0
  })

  it('opens an allowed URL exactly once', () => {
    expect(openExternalSafe('https://example.com/')).toBe(true)
    expect(shell.calls).toEqual([['openExternal', 'https://example.com/']])
  })

  it('never reaches the shell for a blocked scheme', () => {
    expect(openExternalSafe('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(shell.calls).toEqual([])
  })

  it('does not throw on unparseable input', () => {
    expect(() => openExternalSafe('http://[::1')).not.toThrow()
    expect(shell.calls).toEqual([])
  })
})
