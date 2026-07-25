// Single entry point for handing a URL to the OS.
//
// shell.openExternal is a ShellExecute in disguise: given a `file:` URL it runs
// the target, and given a UNC path (`file://host/share/payload.exe`) it fetches
// and runs it over SMB. Everything this app can be asked to open originates in
// untrusted content — mod READMEs, Nexus/Steam descriptions — so the protocol
// must be checked at every call site.
//
// It used to be checked at one of them: the `shell:open-external` IPC handler
// validated http/https, while the BrowserWindow's setWindowOpenHandler passed
// `details.url` straight through. That second path is reachable, because
// Chromium dispatches `auxclick` (not `click`) for a middle-click, so the
// renderer's own anchor guards never see it — the click becomes a new-window
// request instead. Hence one shared helper rather than two checks that drift.

import { shell } from 'electron'
import logger from './logger.js'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

export function isAllowedExternalUrl(url) {
  if (typeof url !== 'string' || !url) return false
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}

// Returns true when the URL was handed to the OS. Never throws, and never
// leaves an unhandled rejection behind: openExternal rejects when no handler is
// registered for the scheme.
export function openExternalSafe(url) {
  if (!isAllowedExternalUrl(url)) {
    logger.warn(`Blocked openExternal for non-http(s) URL: ${String(url).slice(0, 200)}`)
    return false
  }
  shell.openExternal(url).catch((err) => {
    logger.warn(`openExternal failed for ${url}: ${err.message}`)
  })
  return true
}
