// Regression: the config editor's inputs are free text (comment mode renders a
// plain <input> for every keyval; the schema-mode numeric input passes
// e.target.value straight through and its onBlur clamp bails on isNaN). So the
// serializer has to cope with values that would not survive being written bare.
//
// Before the fix, clearing a field produced `ZombieCount = ,` — a Lua syntax
// error that stops the mod's entire config.lua from loading — and a value
// containing " -- " was silently truncated at the next open.
import { describe, it, expect } from 'vitest'
import { parseConfigFile, serializeConfig } from '../../src/renderer/src/utils/config-parser.js'

const LUA = [
  'local Config = {',
  '',
  '-- ====[ GENERAL ]====',
  '    ZombieCount = 500,',
  '    PlayerName = "Survivor",',
  '    SpawnRate = 1.5,        -- higher = more zombies',
  '}',
  'return Config',
].join('\n')

function edit(text, key, newValue) {
  const entries = parseConfigFile(text)
  const i = entries.findIndex(e => e.type === 'keyval' && e.key === key)
  entries[i] = { ...entries[i], value: newValue }
  return serializeConfig(entries)
}
const reread = (text, key) => parseConfigFile(text).find(e => e.type === 'keyval' && e.key === key)

describe('edited values survive a save → reopen cycle', () => {
  const CASES = ['', '42', 'hello', 'a, b', 'has -- dashes', 'trailing,', 'multi word', 'true', "it's", 'say "hi"']

  for (const key of ['ZombieCount', 'PlayerName', 'SpawnRate']) {
    for (const nv of CASES) {
      it(`${key} := ${JSON.stringify(nv)}`, () => {
        const out = edit(LUA, key, nv)
        const back = reread(out, key)
        expect(back, 'key must still be a keyval the editor can show').toBeTruthy()
        expect(back.value).toBe(nv)
      })
    }
  }
})

describe('never emits a syntactically broken assignment', () => {
  it('clearing a numeric field does not produce `Key = ,`', () => {
    const line = edit(LUA, 'ZombieCount', '').split('\n').find(l => l.includes('ZombieCount'))
    expect(line).not.toMatch(/=\s*,/)
    expect(line).toContain('ZombieCount = ""')
  })

  it('clearing a field that carries an inline comment keeps the comment', () => {
    const line = edit(LUA, 'SpawnRate', '').split('\n').find(l => l.includes('SpawnRate'))
    expect(line).not.toMatch(/=\s*,/)
    expect(line).toContain('-- higher = more zombies')
  })

  it('a value containing " -- " is not truncated', () => {
    expect(reread(edit(LUA, 'ZombieCount', 'foo -- bar'), 'ZombieCount').value).toBe('foo -- bar')
  })

  it('an already-quoted field keeps its own quote style', () => {
    const line = edit(LUA, 'PlayerName', '').split('\n').find(l => l.includes('PlayerName'))
    expect(line).toContain('PlayerName = ""')
  })
})

describe('untouched entries are still emitted verbatim', () => {
  it('round-trips an unmodified document byte for byte', () => {
    expect(serializeConfig(parseConfigFile(LUA))).toBe(LUA)
  })

  it('only the edited line changes', () => {
    const out = edit(LUA, 'ZombieCount', '999')
    const a = LUA.split('\n'), b = out.split('\n')
    expect(b.length).toBe(a.length)
    expect(a.filter((l, i) => l !== b[i]).length).toBe(1)
  })
})
