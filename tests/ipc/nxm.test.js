import { describe, it, expect } from 'vitest'
import { parseNxmUrl, findNxmUrlInArgv } from '../../src/main/ipc/nxm.js'

// parseNxmUrl is the trust boundary for OS-delivered protocol links: anything
// it returns flows into API query strings and install identifiers, so every
// malformed shape must come back null (not a partial object).

describe('parseNxmUrl — happy path', () => {
  it('parses a free-user link with key and expires', () => {
    const p = parseNxmUrl('nxm://humanitz/mods/123/files/456?key=abc-DEF_123&expires=1750000000&user_id=42')
    expect(p).toEqual({ game: 'humanitz', modId: 123, fileId: 456, key: 'abc-DEF_123', expires: '1750000000' })
  })

  it('parses a premium link without key/expires (nulls, not undefined)', () => {
    const p = parseNxmUrl('nxm://humanitz/mods/9/files/10')
    expect(p).toEqual({ game: 'humanitz', modId: 9, fileId: 10, key: null, expires: null })
  })

  it('accepts a trailing slash and uppercases game to lowercase', () => {
    const p = parseNxmUrl('nxm://HumanitZ/mods/1/files/2/')
    expect(p?.game).toBe('humanitz')
  })

  it('parses other games (caller decides to reject them)', () => {
    expect(parseNxmUrl('nxm://skyrimspecialedition/mods/1/files/2')?.game).toBe('skyrimspecialedition')
  })
})

describe('parseNxmUrl — malformed input (must all be null)', () => {
  it.each([
    ['wrong scheme', 'https://humanitz/mods/1/files/2'],
    ['no host', 'nxm:///mods/1/files/2'],
    ['host with dots (URL smuggling)', 'nxm://humanitz.evil.com/mods/1/files/2'],
    ['missing files segment', 'nxm://humanitz/mods/123'],
    ['non-numeric mod id', 'nxm://humanitz/mods/abc/files/2'],
    ['non-numeric file id', 'nxm://humanitz/mods/1/files/x'],
    ['zero mod id', 'nxm://humanitz/mods/0/files/2'],
    ['extra path segments', 'nxm://humanitz/mods/1/files/2/extra'],
    ['id overflow (>10 digits)', 'nxm://humanitz/mods/99999999999/files/2'],
    ['not a url', 'definitely not a url'],
    ['empty string', ''],
  ])('%s', (_label, url) => {
    expect(parseNxmUrl(url)).toBeNull()
  })

  it('rejects non-string and oversized input', () => {
    expect(parseNxmUrl(null)).toBeNull()
    expect(parseNxmUrl(12345)).toBeNull()
    expect(parseNxmUrl('nxm://humanitz/mods/1/files/2?key=' + 'a'.repeat(3000))).toBeNull()
  })

  it('drops a key/expires that fail the character whitelist instead of passing them through', () => {
    const badKey = parseNxmUrl('nxm://humanitz/mods/1/files/2?key=abc%26injected%3D1&expires=123')
    expect(badKey?.key).toBeNull()
    const badExpires = parseNxmUrl('nxm://humanitz/mods/1/files/2?key=ok&expires=12x3')
    expect(badExpires?.expires).toBeNull()
    const oversizeKey = parseNxmUrl(`nxm://humanitz/mods/1/files/2?key=${'a'.repeat(300)}&expires=1`)
    expect(oversizeKey?.key).toBeNull()
  })
})

describe('findNxmUrlInArgv', () => {
  it('finds the nxm link among normal args', () => {
    expect(findNxmUrlInArgv(['C:\\app.exe', '--flag', 'nxm://humanitz/mods/1/files/2']))
      .toBe('nxm://humanitz/mods/1/files/2')
  })

  it('returns null when absent or argv is not an array', () => {
    expect(findNxmUrlInArgv(['C:\\app.exe'])).toBeNull()
    expect(findNxmUrlInArgv(undefined)).toBeNull()
  })
})
