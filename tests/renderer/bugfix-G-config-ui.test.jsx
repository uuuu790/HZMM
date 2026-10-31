// @vitest-environment happy-dom
// Regression tests for the config editor UI fixes (cluster G): {eval:}
// formatting, search counting rows that never render, a late save landing on
// another load, line breaks in text values, comment-mode scans crossing
// files, Escape in dropdowns, backdrop drags, INI quoting in a sniffed file,
// non-string i18n values, surrogate-safe truncation, keyboard section headers.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import SchemaRenderer, { formatEvalResult } from '../../src/renderer/src/components/modals/config-editor/SchemaRenderer.jsx'
import CommentModeRenderer from '../../src/renderer/src/components/modals/config-editor/CommentModeRenderer.jsx'
import StringListInput, { restoreLineBreaks } from '../../src/renderer/src/components/modals/config-editor/StringListInput.jsx'
import ConfigEditorModal from '../../src/renderer/src/components/modals/ConfigEditorModal.jsx'
import { parseConfigFile, normalizeSchema } from '../../src/renderer/src/utils/config-parser'
import { buildKeyMatcher, countSchemaMatches, renderableKeys, schemaText } from '../../src/renderer/src/utils/config-search'
import { UI_TEXT } from '../../src/renderer/src/constants/i18n/index.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const en = UI_TEXT.en
const mounted = []
function newRoot() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  mounted.push({ root, el })
  return { el, root }
}
function mount(node) {
  const r = newRoot()
  act(() => r.root.render(node))
  return r.el
}
afterEach(() => {
  for (const { root, el } of mounted.splice(0)) {
    act(() => root.unmount())
    el.remove()
  }
  delete window.api
})

const lua = (text) => parseConfigFile(text, { syntax: 'lua' })

function setValue(input, value) {
  const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  act(() => {
    input.focus()
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function rowOf(el, label) {
  const lbl = [...el.querySelectorAll('label')].find(l => l.textContent === label)
  if (!lbl) throw new Error(`no row ${label}`)
  return lbl.closest('div.py-3\\.5')
}
const hasRow = (el, label) => [...el.querySelectorAll('label')].some(l => l.textContent === label)
const saveButton = (el) => [...el.querySelectorAll('button')].find(b => b.querySelector('.lucide-save'))
const searchBox = (el) => el.querySelector(`input[placeholder="${en.configSearchPlaceholder}"]`)
const counter = (el) => el.querySelector('span.tabular-nums')?.textContent

// ConfigEditorModal against a fake window.api; `files` (path → text) is the
// mod's files, saved text lands back in it. `saveConfig` may be replaced.
async function openModal({ schema = null, files, onClose = () => {}, saveConfig, root: existing }) {
  const store = files
  window.api = {
    mods: {
      getConfigSchema: vi.fn(async () => schema),
      getConfigFiles: vi.fn(async () => Object.keys(store).map(n => ({ name: n, relativePath: n }))),
      readConfig: vi.fn(async (_m, rel) => {
        if (store[rel] === undefined) throw new Error('ENOENT')
        return store[rel]
      }),
      saveConfig: vi.fn(saveConfig || (async (_m, rel, text) => { store[rel] = text })),
    },
  }
  const { el, root } = existing || newRoot()
  const addToast = vi.fn()
  await act(async () => {
    root.render(<ConfigEditorModal isOpen mod={{ filename: 'M' }} onClose={onClose} t={en} lang="en" addToast={addToast} />)
  })
  await act(async () => {})
  return { el, root, store, addToast }
}

function SchemaHarness({ text, schema, ...props }) {
  const [entries, setEntries] = useState(() => lua(text))
  return (
    <SchemaRenderer
      schema={normalizeSchema(schema)}
      entries={entries}
      lang="en"
      onUpdateValue={(i, v) => setEntries(p => p.map((e, j) => (j === i ? { ...e, value: v } : e)))}
      onAddOptional={() => {}}
      onRemoveOptional={() => {}}
      {...props}
    />
  )
}

describe('{eval:} results with float noise print as whole numbers (gid 69)', () => {
  it('formatEvalResult', () => {
    expect(formatEvalResult(1.1 * 100)).toBe('110')
    expect(formatEvalResult(0.07 * 100)).toBe('7')
    expect(formatEvalResult(4.9 * 100)).toBe('490')
    expect(formatEvalResult(-1.1 * 100)).toBe('-110')
    expect(formatEvalResult(70)).toBe('70')
    expect(formatEvalResult(52.5)).toBe('52.50')
    expect(formatEvalResult(0.125)).toBe('0.13')
    expect(formatEvalResult(1e6 + 0.0001)).toBe('1000000.00')
    expect(formatEvalResult(1234567890123)).toBe('1234567890123')
  })

  it('a slider at 1.1 shows "110%", not "110.00%"; 52.5 keeps two decimals', () => {
    const schema = {
      configFile: 'config.lua',
      sections: { S: { keys: {
        DamageMul: { type: 'float', widget: 'slider', min: 0.1, max: 5, step: 0.1, description: 'Deals {eval: value * 100}% of normal damage.' },
        Carry: { type: 'int', description: 'Max carry {eval: 35 * (1 + value / 100)} kg' },
      } } },
    }
    const el = mount(<SchemaHarness text={'local C = {\n    DamageMul = 1.1,\n    Carry = 50,\n}\nreturn C\n'} schema={schema} />)
    expect(rowOf(el, 'DamageMul').querySelector('p').textContent).toBe('Deals 110% of normal damage.')
    expect(rowOf(el, 'Carry').querySelector('p').textContent).toBe('Max carry 52.50 kg')
  })
})

describe('search counts only keys that get a row (gids 70, 76)', () => {
  const schema = {
    configFile: 'config.lua',
    sections: {
      General: { label: 'General', keys: { MaxHealth: { type: 'int', label: 'Max health' } } },
      Stamina: { label: 'Stamina', keys: {
        MaxStamina: { type: 'int' },
        Regen: { type: 'int' },
        Boost: { type: 'int', optional: true, default: 2 },
      } },
    },
  }
  const text = 'local Config = {\n    MaxHealth = 100,\n}\nreturn Config\n'

  it('countSchemaMatches with renderableKeys skips absent non-optional keys', () => {
    const entries = lua(text)
    const norm = normalizeSchema(schema)
    expect(countSchemaMatches(norm, buildKeyMatcher('stamina', 'en'), 'en', renderableKeys(entries)))
      .toEqual({ matched: 1, total: 2 }) // Boost (optional) only; MaxHealth + Boost in total
    expect(countSchemaMatches(norm, buildKeyMatcher('regen', 'en'), 'en', renderableKeys(entries)))
      .toEqual({ matched: 0, total: 2 })
    // without the predicate: every schema key (existing callers)
    expect(countSchemaMatches(norm, buildKeyMatcher('regen', 'en'), 'en')).toEqual({ matched: 1, total: 4 })
  })

  it('a search matching only absent keys shows "no match" and 0/N, no bare header', async () => {
    const { el } = await openModal({ schema, files: { 'config.lua': text } })
    setValue(searchBox(el), 'regen')
    expect(el.textContent).toContain(en.configSearchNoMatch)
    expect(counter(el)).toBe('0/2')
    expect(el.textContent).not.toContain('Stamina')

    // a section whose only shown match is the optional key still renders it
    setValue(searchBox(el), 'stamina')
    expect(counter(el)).toBe('1/2')
    expect(hasRow(el, 'Boost')).toBe(true)
    expect(el.textContent).not.toContain(en.configSearchNoMatch)
  })
})

describe('a save that finishes late (gid 71)', () => {
  const schema = { configFile: 'config.lua', sections: { S: { label: 'S', keys: { Speed: { type: 'int' }, Other: { type: 'int' } } } } }

  it('an edit typed while the save runs survives, and Save stays enabled', async () => {
    const pending = []
    const files = { 'config.lua': 'local Config = {\n    Speed = 1,\n    Other = 5,\n}\nreturn Config\n' }
    const { el } = await openModal({
      schema,
      files,
      saveConfig: (_m, rel, text) => new Promise(res => { pending.push(() => { files[rel] = text; res(true) }) }),
    })
    setValue(rowOf(el, 'Speed').querySelector('input'), '42')
    await act(async () => { saveButton(el).click() })
    setValue(rowOf(el, 'Other').querySelector('input'), '77')
    await act(async () => { pending.shift()() })
    await act(async () => {})
    expect(files['config.lua']).toContain('Speed = 42,')
    expect(rowOf(el, 'Other').querySelector('input').value).toBe('77')
    expect(saveButton(el).disabled).toBe(false)
    expect(saveButton(el).textContent).toBe(en.configSave)

    await act(async () => { saveButton(el).click() })
    await act(async () => { pending.shift()() })
    await act(async () => {})
    expect(files['config.lua']).toBe('local Config = {\n    Speed = 42,\n    Other = 77,\n}\nreturn Config\n')
    expect(saveButton(el).disabled).toBe(true)
  })

  it("mod A's late result never lands on mod B, and B's Save isn't stuck", async () => {
    const texts = {
      A: 'local Config = {\n    Speed = 1,\n}\nreturn Config\n',
      B: 'local Config = {\n    Speed = 99,\n    Other = 5,\n}\nreturn Config\n',
    }
    const pending = []
    window.api = {
      mods: {
        getConfigSchema: vi.fn(async () => schema),
        getConfigFiles: vi.fn(async () => []),
        readConfig: vi.fn(async (m) => texts[m]),
        saveConfig: vi.fn((m, _rel, text) => new Promise(res => { pending.push(() => { texts[m] = text; res(true) }) })),
      },
    }
    const { el, root } = newRoot()
    const render = async (props) => {
      await act(async () => { root.render(<ConfigEditorModal t={en} lang="en" onClose={() => {}} addToast={() => {}} {...props} />) })
      await act(async () => {})
    }
    await render({ isOpen: true, mod: { filename: 'A' } })
    setValue(rowOf(el, 'Speed').querySelector('input'), '42')
    await act(async () => { saveButton(el).click() })
    await render({ isOpen: false, mod: null })
    await render({ isOpen: true, mod: { filename: 'B' } })
    expect(saveButton(el).textContent).toBe(en.configSaved)

    await act(async () => { pending.shift()() })
    await act(async () => {})
    expect(texts.A).toContain('Speed = 42,')
    expect(rowOf(el, 'Speed').querySelector('input').value).toBe('99')
    expect(rowOf(el, 'Other').querySelector('input').value).toBe('5')

    setValue(rowOf(el, 'Speed').querySelector('input'), '43')
    await act(async () => { saveButton(el).click() })
    await act(async () => { pending.shift()() })
    await act(async () => {})
    expect(texts.B).toBe('local Config = {\n    Speed = 43,\n    Other = 5,\n}\nreturn Config\n')
  })
})

describe('a text value with a line break keeps it (gid 72)', () => {
  it('schema text row: a textarea; the edit saves with the \\n escape', async () => {
    const schema = { configFile: 'config.lua', sections: { S: { label: 'S', keys: { Motd: { type: 'text' } } } } }
    const files = { 'config.lua': 'local Config = {\n    Motd = "Welcome!\\nHave fun",\n}\nreturn Config\n' }
    const { el } = await openModal({ schema, files })
    const box = rowOf(el, 'Motd').querySelector('textarea')
    expect(box).not.toBeNull()
    expect(box.value).toBe('Welcome!\nHave fun')
    setValue(box, 'Welcome!\nHave fun!')
    await act(async () => { saveButton(el).click() })
    expect(files['config.lua']).toContain('    Motd = "Welcome!\\nHave fun!",')
  })

  it('stays a textarea after its last line break is deleted (no element swap mid-edit)', async () => {
    const schema = { configFile: 'config.lua', sections: { S: { label: 'S', keys: { Motd: { type: 'text' } } } } }
    const { el } = await openModal({ schema, files: { 'config.lua': 'local Config = {\n    Motd = "a\\nb",\n}\nreturn Config\n' } })
    const box = rowOf(el, 'Motd').querySelector('textarea')
    setValue(box, 'ab')
    expect(rowOf(el, 'Motd').querySelector('textarea')).toBe(box)
    expect(box.value).toBe('ab')
  })

  it('a value without a line break is still a one-line input', async () => {
    const schema = { configFile: 'config.lua', sections: { S: { label: 'S', keys: { Name: { type: 'text' } } } } }
    const { el } = await openModal({ schema, files: { 'config.lua': 'local Config = {\n    Name = "Bob",\n}\nreturn Config\n' } })
    expect(rowOf(el, 'Name').querySelector('input[type="text"]').value).toBe('Bob')
    expect(rowOf(el, 'Name').querySelector('textarea')).toBeNull()
  })

  it('comment mode text row: a textarea that keeps the line break', async () => {
    const files = { 'config.lua': 'local Config = {\n    -- Motd - message of the day\n    Motd = "a\\nb",\n}\nreturn Config\n' }
    const { el } = await openModal({ files })
    const box = rowOf(el, 'Motd').querySelector('textarea')
    expect(box.value).toBe('a\nb')
    setValue(box, 'a\nbc')
    await act(async () => { saveButton(el).click() })
    expect(files['config.lua']).toContain('    Motd = "a\\nbc",')
  })

  it('string list item: a textarea that keeps the line break', () => {
    const onChange = vi.fn()
    const el = mount(<StringListInput value={'{"a\\nb", "c"}'} onChange={onChange} />)
    const [first, second] = [...el.querySelectorAll('textarea, input')]
    expect(first.tagName).toBe('TEXTAREA')
    expect(first.value).toBe('a\nb')
    expect(second.tagName).toBe('INPUT')
    setValue(first, 'a\nbx')
    expect(onChange).toHaveBeenLastCalledWith('{"a\\nbx", "c"}')
  })
})

// A <textarea> reports CRLF and lone CR as LF (Chromium does; happy-dom
// doesn't, so these tests hand the box the LF-only text Chromium would).
describe('a text value with a decoded \\r keeps it after an edit (gid 72 follow-up)', () => {
  it('restoreLineBreaks', () => {
    // No CR in the old value, or the new text already has CRs: unchanged.
    expect(restoreLineBreaks('a\nb', 'a\nbc')).toBe('a\nbc')
    expect(restoreLineBreaks('a\r\nb', 'a\r\nbc')).toBe('a\r\nbc')
    // Untouched (normalized only): the original comes back exactly.
    expect(restoreLineBreaks('a\r\nb\rc\nd', 'a\nb\nc\nd')).toBe('a\r\nb\rc\nd')
    // Typing keeps every existing break as it was.
    expect(restoreLineBreaks('a\r\nb', 'a\nbc')).toBe('a\r\nbc')
    expect(restoreLineBreaks('x\ry', 'x!\ny')).toBe('x!\ry')
    expect(restoreLineBreaks('a\r\nb\rc\nd', 'a\nb\nc\nd!')).toBe('a\r\nb\rc\nd!')
    expect(restoreLineBreaks('a\r\nb\rc\nd', 'A\nb\nc\nd')).toBe('A\r\nb\rc\nd')
    // A new break (Enter / paste) takes the value's style when it has one.
    expect(restoreLineBreaks('a\r\nb', 'a\nb\nc')).toBe('a\r\nb\r\nc')
    expect(restoreLineBreaks('a\rb', 'a\n\nb')).toBe('a\r\rb')
    expect(restoreLineBreaks('a\r\nb\nc', 'a\nb\nc\nd')).toBe('a\r\nb\nc\nd')
    // Deleting a break removes the whole CRLF, nothing half-left.
    expect(restoreLineBreaks('a\r\nb', 'ab')).toBe('ab')
    expect(restoreLineBreaks('a\r\n\r\nb', 'a\nb')).toBe('a\r\nb')
    expect(restoreLineBreaks('a\r\nb', '')).toBe('')
  })

  it('schema text row: an edit saves the \\r\\n escape, not \\n', async () => {
    const schema = { configFile: 'config.lua', sections: { S: { label: 'S', keys: { Motd: { type: 'text' } } } } }
    const files = { 'config.lua': 'local Config = {\n    Motd = "Welcome!\\r\\nHave fun",\n}\nreturn Config\n' }
    const { el } = await openModal({ schema, files })
    const box = rowOf(el, 'Motd').querySelector('textarea')
    expect(box.value).toBe('Welcome!\r\nHave fun')
    setValue(box, 'Welcome!\nHave fun!')
    await act(async () => { saveButton(el).click() })
    expect(files['config.lua']).toContain('    Motd = "Welcome!\\r\\nHave fun!",')
  })

  it('comment mode text row: a lone \\r stays \\r', async () => {
    const files = { 'config.lua': 'local Config = {\n    -- Motd - message of the day\n    Motd = "a\\rb",\n}\nreturn Config\n' }
    const { el } = await openModal({ files })
    const box = rowOf(el, 'Motd').querySelector('textarea')
    setValue(box, 'a\nbc')
    await act(async () => { saveButton(el).click() })
    expect(files['config.lua']).toContain('    Motd = "a\\rbc",')
  })

  it('string list item: \\r\\n kept, and Enter adds a CRLF too', () => {
    const onChange = vi.fn()
    const el = mount(<StringListInput value={'{"a\\r\\nb", "c"}'} onChange={onChange} />)
    const first = el.querySelector('textarea')
    setValue(first, 'a\nbx')
    expect(onChange).toHaveBeenLastCalledWith('{"a\\r\\nbx", "c"}')
    setValue(first, 'a\nb\nx')
    expect(onChange).toHaveBeenLastCalledWith('{"a\\r\\nb\\r\\nx", "c"}')
  })
})

describe('comment mode: scans stop at the end of the file (gid 73)', () => {
  const disabled = (el, label) => rowOf(el, label).querySelector('fieldset').disabled

  it("an Enable* key set to false in one file doesn't gate the next file", async () => {
    const { el } = await openModal({ files: {
      'General.ini': 'EnableDebug = false\nDebugLevel = 2\n',
      'Keybinds.ini': 'OpenMenu = F6\nMenuScale = 1.0\n',
    } })
    expect(disabled(el, 'DebugLevel')).toBe(true)
    expect(disabled(el, 'OpenMenu')).toBe(false)
    expect(disabled(el, 'MenuScale')).toBe(false)
  })

  it('a trailing keyless [Section] of one file is not shown as the next file\'s header', async () => {
    const { el } = await openModal({ files: {
      'a.ini': '[Main]\nSpeed = 1\n[Unused]\n',
      'b.ini': 'Volume = 5\n',
    } })
    const headers = [...el.querySelectorAll('h4')].map(h => h.textContent)
    expect(headers).toEqual(['Main'])
  })

  it("a dependency comment only looks at keys of its own file", async () => {
    const { el } = await openModal({ files: {
      'a.ini': 'Mode = Easy\n',
      'b.ini': 'Mode = Hard\n; Active when Mode = "Hard"\nBonus = 3\n',
    } })
    expect(disabled(el, 'Bonus')).toBe(false)
  })
})

describe('Escape with a dropdown open closes the dropdown only (gid 74)', () => {
  const escape = (target) => act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })

  it.each([
    ['select', { type: 'select', options: ['Easy', 'Normal', 'Hard'] }, '"Easy"'],
    ['multi-select', { type: 'multi-select', options: ['Fire', 'Ice', 'Poison'] }, '{"Fire"}'],
  ])('%s', async (_name, keyDef, value) => {
    const onClose = vi.fn()
    const schema = { configFile: 'config.lua', sections: { S: { label: 'S', keys: { Mode: keyDef } } } }
    const { el } = await openModal({ schema, files: { 'config.lua': `local Config = {\n    Mode = ${value},\n}\nreturn Config\n` }, onClose })
    const buttons = () => rowOf(el, 'Mode').querySelectorAll('fieldset button')
    const trigger = buttons()[0]
    await act(async () => { trigger.click() })
    expect(buttons().length).toBe(4)
    escape(trigger)
    expect(onClose).not.toHaveBeenCalled()
    expect(buttons().length).toBe(1)
    escape(trigger)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('a drag from inside the dialog released on the backdrop (gid 75)', () => {
  it("doesn't close the editor; a press and release on the backdrop does", async () => {
    const onClose = vi.fn()
    const schema = { configFile: 'config.lua', sections: { S: { label: 'S', keys: { Name: { type: 'text' } } } } }
    const { el } = await openModal({ schema, files: { 'config.lua': 'local Config = {\n    Name = "Bob",\n}\nreturn Config\n' }, onClose })
    const overlay = el.firstElementChild
    const backdrop = overlay.firstElementChild
    const input = rowOf(el, 'Name').querySelector('input')
    const fire = (node, type) => act(() => { node.dispatchEvent(new MouseEvent(type, { bubbles: true })) })

    // Chromium sends the click of a mousedown-in-input / mouseup-on-backdrop
    // drag to the overlay (their common ancestor).
    fire(input, 'mousedown')
    fire(overlay, 'click')
    expect(onClose).not.toHaveBeenCalled()

    fire(input, 'mousedown')
    fire(input, 'click')
    expect(onClose).not.toHaveBeenCalled()

    fire(backdrop, 'mousedown')
    fire(backdrop, 'click')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('optional key switched on in a sniffed INI file with no keys yet (gid 77)', () => {
  const keys = { ServerName: { type: 'text', optional: true, default: 'My Server' } }

  it.each(['settings.conf', 'config.txt', 'settings.ini'])('%s: written unquoted', async (configFile) => {
    const files = { [configFile]: '[General]\n' }
    const { el } = await openModal({ schema: { configFile, sections: { General: { label: 'General', keys } } }, files })
    await act(async () => { rowOf(el, 'ServerName').querySelector('button[aria-pressed]').click() })
    await act(async () => { saveButton(el).click() })
    expect(files[configFile]).toBe('[General]\nServerName = My Server\n')
  })

  it('a Lua file with no keys yet still quotes a text value', async () => {
    const files = { 'config.lua': 'local Config = {}\nreturn Config\n' }
    const { el } = await openModal({ schema: { configFile: 'config.lua', sections: { General: { label: 'General', keys } } }, files })
    await act(async () => { rowOf(el, 'ServerName').querySelector('button[aria-pressed]').click() })
    await act(async () => { saveButton(el).click() })
    expect(files['config.lua']).toContain('ServerName = "My Server",')
  })
})

describe('non-string i18n values in the schema (gid 78)', () => {
  it('schemaText only ever returns a string', () => {
    expect(schemaText({ en: 5 }, 'en')).toBe('')
    expect(schemaText({ en: ['a', 'b'] }, 'en')).toBe('')
    expect(schemaText({ en: { t: 1 } }, 'en')).toBe('')
    expect(schemaText({ en: 5, de: 'Hallo' }, 'en')).toBe('Hallo')
    expect(schemaText({ 'zh-TW': '速度', en: 'Speed' }, 'zh-TW')).toBe('速度')
    expect(schemaText({ 'zh-TW': '', en: 'Speed' }, 'zh-TW')).toBe('Speed')
    expect(schemaText('plain', 'en')).toBe('plain')
    expect(schemaText(5, 'en')).toBe('')
    expect(schemaText(null, 'en')).toBe('')
  })

  it('renders the row (key name, no description) instead of crashing; search works', async () => {
    const schema = {
      configFile: 'config.lua',
      sections: { S: { label: { en: { x: 1 } }, keys: {
        Speed: { type: 'int', label: { en: {} }, description: { en: 5 } },
        Rate: { type: 'int', description: { en: ['a', 'b'] } },
      } } },
    }
    const { el } = await openModal({ schema, files: { 'config.lua': 'local Config = {\n    Speed = 1,\n    Rate = 2,\n}\nreturn Config\n' } })
    expect(rowOf(el, 'Speed').querySelector('p')).toBeNull()
    expect(rowOf(el, 'Rate').querySelector('p')).toBeNull()
    expect([...el.querySelectorAll('h4')].map(h => h.textContent)).toEqual(['S'])
    setValue(searchBox(el), 'rate')
    expect(counter(el)).toBe('1/2')
    expect(hasRow(el, 'Rate')).toBe(true)
    expect(hasRow(el, 'Speed')).toBe(false)
  })
})

describe('comment-mode description truncation (gid 80)', () => {
  it('never splits a surrogate pair', () => {
    const desc = 'a'.repeat(59) + '\u{1F525} hot stuff'
    const entries = lua(`local Config = {\n    -- Rate - ${desc}\n    Rate = 5,\n}\nreturn Config\n`)
    const el = mount(<CommentModeRenderer entries={entries} lang="en" onUpdateValue={() => {}} />)
    const shown = rowOf(el, 'Rate').querySelector('p').textContent
    expect(shown).toBe('a'.repeat(59) + '...')
    expect(shown.isWellFormed()).toBe(true)
  })

  it('keeps an emoji that ends exactly at the cut', () => {
    const desc = 'a'.repeat(58) + '\u{1F525}' + ' more text'
    const entries = lua(`local Config = {\n    -- Rate - ${desc}\n    Rate = 5,\n}\nreturn Config\n`)
    const el = mount(<CommentModeRenderer entries={entries} lang="en" onUpdateValue={() => {}} />)
    expect(rowOf(el, 'Rate').querySelector('p').textContent).toBe('a'.repeat(58) + '\u{1F525}...')
  })
})

describe('section headers work from the keyboard (gid 81)', () => {
  const sections = {}
  const lines = []
  for (let i = 1; i <= 11; i++) {
    sections[`Sec${i}`] = { label: `Section ${i}`, keys: { [`Key${i}`]: { type: 'int' } } }
    lines.push(`    Key${i} = ${i},`)
  }
  const schema = { configFile: 'config.lua', sections }
  const text = `local Config = {\n${lines.join('\n')}\n}\nreturn Config\n`
  const headerButton = (el, label) => [...el.querySelectorAll('h4 button')].find(b => b.textContent === label)

  it('each header is a focusable button with aria-expanded; activating it opens the section', () => {
    const el = mount(<SchemaHarness text={text} schema={schema} />)
    const btn = headerButton(el, 'Section 3')
    expect(btn.disabled).toBe(false)
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(hasRow(el, 'Key3')).toBe(false)
    act(() => btn.focus())
    expect(document.activeElement).toBe(btn)
    act(() => btn.click())
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(hasRow(el, 'Key3')).toBe(true)
    act(() => btn.click())
    expect(hasRow(el, 'Key3')).toBe(false)
  })

  it('while searching the matched sections are forced open and the headers are inert', () => {
    const el = mount(<SchemaHarness text={text} schema={schema} searchActive matcher={(k) => k === 'Key4'} />)
    const btn = headerButton(el, 'Section 4')
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(hasRow(el, 'Key4')).toBe(true)
  })
})
