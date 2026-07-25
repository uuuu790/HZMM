import { describe, it, expect } from 'vitest'
import { ALLOWED_SETTINGS_KEYS, READABLE_SETTINGS_KEYS } from '../../src/main/ipc/settings.js'

// The whitelist is the only line of defense between the renderer and the
// settings file. A drift here means either:
//   a) a real key gets rejected (toggle silently fails to persist — like the
//      `skipInstallPreview` regression caught in 1.3.6), or
//   b) an unintended key sneaks in (the renderer writes garbage to disk).
//
// These tests pin the whitelist's expected contents so future edits surface
// either the diff or a deliberate test update.

describe('ALLOWED_SETTINGS_KEYS', () => {
  it('is a Set', () => {
    expect(ALLOWED_SETTINGS_KEYS).toBeInstanceOf(Set)
  })

  // The keys actually written by the renderer (App.jsx + Settings tab + hooks).
  // Adding a new persisted setting in renderer must add it here too.
  const REQUIRED_KEYS = [
    'themeId', 'darkMode',
    'minimizeToTray',
    'nexusApiKey',
    'ue4ssVersion',
    'windowState',
    'profiles', 'activeProfileId',
    'nexusInstalledMods',
    'skipInstallPreview',
    'uiZoom',
  ]

  it.each(REQUIRED_KEYS)('whitelists %s', (key) => {
    expect(ALLOWED_SETTINGS_KEYS.has(key)).toBe(true)
  })

  // PRIVILEGE-ESCALATION REGRESSION — do not re-add gamePath.
  //
  // settings:set validates the KEY but never the VALUE. gamePath is the root
  // every other filesystem operation resolves against: install targets, the
  // UE4SS Mods folder, shell:open-path's allow-list, and the exe game:launch
  // spawns. Whitelisting it let the renderer re-point all of those at any
  // directory while skipping game:set-path's "is this a HumanitZ install"
  // validation. game:set-path is the only entry point that may write it.
  it('does NOT whitelist gamePath (it must go through the validating game:set-path)', () => {
    expect(ALLOWED_SETTINGS_KEYS.has('gamePath')).toBe(false)
  })

  it('rejects keys never written by the app', () => {
    expect(ALLOWED_SETTINGS_KEYS.has('language')).toBe(false) // moved to locale:set-preference
    expect(ALLOWED_SETTINGS_KEYS.has('theme')).toBe(false) // superseded by themeId
    expect(ALLOWED_SETTINGS_KEYS.has('autoCheckUpdate')).toBe(false) // removed: unread
    expect(ALLOWED_SETTINGS_KEYS.has('lastTab')).toBe(false) // removed: unread
    expect(ALLOWED_SETTINGS_KEYS.has('arbitraryKey')).toBe(false)
    expect(ALLOWED_SETTINGS_KEYS.has('__proto__')).toBe(false)
    expect(ALLOWED_SETTINGS_KEYS.has('')).toBe(false)
  })

  it('size matches the expected key count (catches accidental adds/removes)', () => {
    // If you intentionally add or remove a key, update REQUIRED_KEYS above
    // and bump this number. The point is to make a silent drift loud.
    expect(ALLOWED_SETTINGS_KEYS.size).toBe(REQUIRED_KEYS.length)
  })
})

// INFORMATION-DISCLOSURE REGRESSION.
//
// settings:get had no allow-list at all — it was a "read any key in
// config.json" primitive for the renderer. This app renders untrusted mod
// README/BBCode HTML, so anything that ever slipped past DOMPurify could have
// read the entire store in one call. Keep the read surface to what the UI
// genuinely uses.
describe('READABLE_SETTINGS_KEYS', () => {
  // Every key the renderer passes to window.api.settings.get(...).
  const KEYS_READ_BY_UI = [
    'darkMode', 'themeId', 'minimizeToTray', 'skipInstallPreview', 'uiZoom',
    'nexusApiKey', 'profiles', 'activeProfileId',
  ]

  it.each(KEYS_READ_BY_UI)('allows reading %s', (key) => {
    expect(READABLE_SETTINGS_KEYS.has(key)).toBe(true)
  })

  it('does not expose keys the UI never reads', () => {
    for (const key of ['gamePath', 'ue4ssVersion', 'ue4ssPublishedAt',
      'windowState', 'nexusInstalledMods', 'arbitraryKey', '__proto__', '']) {
      expect(READABLE_SETTINGS_KEYS.has(key)).toBe(false)
    }
  })

  it('is not simply a copy of the writable list', () => {
    expect(READABLE_SETTINGS_KEYS.size).toBeLessThan(ALLOWED_SETTINGS_KEYS.size + 1)
    expect(ALLOWED_SETTINGS_KEYS.has('windowState')).toBe(true)
    expect(READABLE_SETTINGS_KEYS.has('windowState')).toBe(false)
  })
})
