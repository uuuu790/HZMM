import { describe, it, expect } from 'vitest'
import luaparse from 'luaparse'
import {
  parseConfigFile,
  serializeConfig,
  appendKeyval,
  buildEntryKeyDefMap,
  normalizeSchema,
  parseLuaArray,
  parseLuaArrayItems,
  serializeLuaArray,
} from '../../src/renderer/src/utils/config-parser'
import {
  valueEqualsDefault,
  entriesAtDefaults,
  resetEntriesToDefaults,
  prepareEntriesForSave,
} from '../../src/renderer/src/utils/widget-helpers'

// Regression tests for cluster F (config engine): gids 64-68.

const BOM = '﻿'
const parse = (text, syntax = 'lua') => parseConfigFile(text, { syntax })
const kv = (entries, key) => entries.find(e => e.type === 'keyval' && e.key === key)
const expectLuaParses = (text) => expect(() => luaparse.parse(text, { luaVersion: '5.3' })).not.toThrow()

describe('gid 64: inline descriptions keep a numeric range', () => {
  it('Lua: a range comment is not cut, a numbering prefix still is', () => {
    const entries = parse([
      'local Config = {',
      '    Volume = 50, -- 0-100',
      '    Players = 4, -- 1 - 16 players',
      '    Delay = 30, -- 10-60 seconds recommended',
      '    Mode = 1, -- 1 - Easy',
      '}',
      'return Config',
      '',
    ].join('\n'))
    expect(kv(entries, 'Volume').inlineDesc).toBe('0-100')
    expect(kv(entries, 'Players').inlineDesc).toBe('1 - 16 players')
    expect(kv(entries, 'Delay').inlineDesc).toBe('10-60 seconds recommended')
    expect(kv(entries, 'Mode').inlineDesc).toBe('Easy')
  })

  it('INI: the same rules apply to `;` comments', () => {
    const entries = parse('[G]\nFov = 90 ; 60 - 120 degrees\nVolume = 5 ; 0-100\nMode = 2 ; 2 - Hard\n', 'ini')
    expect(kv(entries, 'Fov').inlineDesc).toBe('60 - 120 degrees')
    expect(kv(entries, 'Volume').inlineDesc).toBe('0-100')
    expect(kv(entries, 'Mode').inlineDesc).toBe('Hard')
  })
})

describe('gid 65: INI insert next to a line carrying a UTF-8 BOM', () => {
  const append = (text, opts = {}) => {
    const entries = parse(text, 'ini')
    const out = appendKeyval(entries, 'Brightness', '7', { format: 'ini', ...opts })
    expect(out).not.toBe(entries)
    return serializeConfig(out)
  }

  it('copies the `=` spacing of a BOM line, not the BOM itself', () => {
    expect(append(`${BOM}Volume = 5\n`)).toBe(`${BOM}Volume = 5\nBrightness = 7\n`)
    expect(append(`${BOM}Volume=5\n`)).toBe(`${BOM}Volume=5\nBrightness=7\n`)
  })

  it('inserts into an empty banner or real section after a BOM line', () => {
    expect(append(`${BOM}Volume = 5\n; ====[ Video ]====\n`, { sectionHint: 'Video' }))
      .toBe(`${BOM}Volume = 5\n; ====[ Video ]====\nBrightness = 7\n`)
    expect(append(`${BOM}Volume = 5\n[Video]\n`, { sectionHint: 'Video' }))
      .toBe(`${BOM}Volume = 5\n[Video]\nBrightness = 7\n`)
  })
})

describe('gid 66: a `; return` inside a function body is not the chunk\'s return', () => {
  it('a one-line helper function does not make a globals file "return a value"', () => {
    const text = 'local function pct(x) x = x / 100; return x end\nDamage = 50\n'
    const entries = parse(text)
    expect(entries[0].returnStmt).toBeFalsy()
    expect(entries[0].returnsValue).toBeFalsy()
    const out = appendKeyval(entries, 'Extra', '1')
    expect(out).not.toBe(entries)
    const saved = serializeConfig(out)
    expect(saved).toBe('local function pct(x) x = x / 100; return x end\nDamage = 50\nExtra = 1\n')
    expectLuaParses(saved)
  })

  it('a multi-line function field whose last line has `; return x end`', () => {
    const text = 'Fn = function(x)\n  x = x / 100; return x end\nDamage = 50\n'
    const entries = parse(text)
    expect(kv(entries, 'Fn').returnsValue).toBeFalsy()
    const out = appendKeyval(entries, 'Extra', '1')
    expect(out).not.toBe(entries)
    expect(serializeConfig(out)).toBe(`${text}Extra = 1\n`)
  })

  it('still sees a chunk-level return and what it returns', () => {
    const named = parse('local C = {}; return C\n')
    expect(named[0].returnStmt).toBe(true)
    expect(named[0].returnsValue).toBe(true)

    const fn = parse('Damage = 50\nreturn function() return 1 end\n')
    expect(fn[1].returnStmt).toBe(true)
    expect(fn[1].returnsValue).toBe(true)
    expect(appendKeyval(fn, 'Extra', '1')).toBe(fn)

    const after = parse('local function f() return 1 end; return f\nDamage = 50\n')
    expect(after[0].returnsValue).toBe(true)
  })

  it('the `end` closing an if block is not a returned value', () => {
    const entries = parse('if DEBUG then Damage = 1; return end\nA = 1\n')
    expect(entries[0].returnStmt).toBe(true)
    expect(entries[0].returnsValue).toBeFalsy()
    const out = appendKeyval(entries, 'Extra', '1')
    expect(out).not.toBe(entries)
    expectLuaParses(serializeConfig(out))
  })
})

describe('gid 67: a concatenation in a list is code, not one string', () => {
  it('parseLuaArrayItems keeps `"a" .. "b"` bare', () => {
    expect(parseLuaArrayItems('{"Sir " .. "Bob", "Alice"}')).toEqual([
      { text: '"Sir " .. "Bob"', bare: true },
      { text: 'Alice', bare: false },
    ])
    expect(parseLuaArrayItems("{'a' .. tostring(1) .. 'b'}")).toEqual([{ text: "'a' .. tostring(1) .. 'b'", bare: true }])
    // A single literal is still a quoted item.
    expect(parseLuaArrayItems('{"a\\"b", \'c\'}')).toEqual([{ text: 'a"b', bare: false }, { text: 'c', bare: false }])
  })

  it('editing another item keeps the concatenation verbatim', () => {
    const text = 'local Config = {\n    Names = {"Sir " .. "Bob", "Alice"},\n}\nreturn Config\n'
    const entries = parse(text)
    const schema = normalizeSchema({ sections: { S: { keys: { Names: { type: 'list' } } } } })
    const map = buildEntryKeyDefMap(entries, schema)
    const names = kv(entries, 'Names')
    expect(names.readonly).toBeFalsy()
    // What StringListInput does when item 1 changes.
    const items = parseLuaArray(names.value)
    const edited = entries.map(e => (e === names ? { ...e, value: serializeLuaArray([items[0], 'Carol']) } : e))
    const saved = serializeConfig(prepareEntriesForSave(edited, map))
    expect(saved).toBe(text.replace('"Alice"', '"Carol"'))
    expectLuaParses(saved)
  })
})

describe('gid 68: typeless keys compare by their inferred type', () => {
  it('valueEqualsDefault takes the row\'s type for a missing / unknown schema type', () => {
    expect(valueEqualsDefault("{'a', 'b'}", { default: ['a', 'b'] }, 'list')).toBe(true)
    expect(valueEqualsDefault('25.0', { default: 25 }, 'float')).toBe(true)
    expect(valueEqualsDefault('1.50', { type: 'number', default: 1.5 }, 'float')).toBe(true)
    expect(valueEqualsDefault('25.5', { default: 25 }, 'float')).toBe(false)
    // A known schema type still decides.
    expect(valueEqualsDefault('25.0', { type: 'string', default: 25 }, 'float')).toBe(false)
  })

  it('a typeless file at its defaults is at defaults, and reset leaves it alone', () => {
    const text = 'local Config = {\n    Speed = 25.0,\n    Tags = {\'a\', \'b\'},\n    Ratio = 1.50,\n}\nreturn Config\n'
    const entries = parse(text)
    const schema = normalizeSchema({ sections: { S: { keys: { Speed: { default: 25 }, Tags: { default: ['a', 'b'] }, Ratio: { default: 1.5 } } } } })
    const map = buildEntryKeyDefMap(entries, schema)
    expect(entriesAtDefaults(entries, map)).toBe(true)
    expect(serializeConfig(resetEntriesToDefaults(entries, map))).toBe(text)
  })

  it('a typeless value off its default is still reset', () => {
    const entries = parse('local Config = {\n    Speed = 30.0,\n}\nreturn Config\n')
    const map = buildEntryKeyDefMap(entries, normalizeSchema({ sections: { S: { keys: { Speed: { default: 25 } } } } }))
    expect(entriesAtDefaults(entries, map)).toBe(false)
    expect(serializeConfig(resetEntriesToDefaults(entries, map))).toBe('local Config = {\n    Speed = 25,\n}\nreturn Config\n')
  })
})
