import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { UI_TEXT } from '../../src/renderer/src/constants/i18n/index.js'

const LANGUAGES = Object.keys(UI_TEXT)
const REFERENCE_LANG = 'zh-TW'

describe('i18n completeness', () => {
  it('has all expected languages', () => {
    expect(LANGUAGES).toContain('zh-TW')
    expect(LANGUAGES).toContain('en')
    expect(LANGUAGES).toContain('ja')
    expect(LANGUAGES).toContain('ko')
    expect(LANGUAGES).toContain('ru')
    expect(LANGUAGES).toContain('de')
    expect(LANGUAGES).toContain('fr')
    expect(LANGUAGES.length).toBe(7)
  })

  const referenceKeys = Object.keys(UI_TEXT[REFERENCE_LANG]).sort()

  for (const lang of Object.keys(UI_TEXT)) {
    if (lang === REFERENCE_LANG) continue

    describe(`${lang} vs ${REFERENCE_LANG}`, () => {
      const langKeys = Object.keys(UI_TEXT[lang]).sort()

      it('has no missing keys', () => {
        const missing = referenceKeys.filter(k => !langKeys.includes(k))
        expect(missing, `${lang} is missing keys: ${missing.join(', ')}`).toEqual([])
      })

      it('has no extra keys', () => {
        const extra = langKeys.filter(k => !referenceKeys.includes(k))
        expect(extra, `${lang} has extra keys: ${extra.join(', ')}`).toEqual([])
      })

      it('has no empty string values', () => {
        const empty = langKeys.filter(k => UI_TEXT[lang][k] === '')
        expect(empty, `${lang} has empty values: ${empty.join(', ')}`).toEqual([])
      })
    })
  }
})

// USED-BUT-UNDEFINED REGRESSION.
//
// The parity checks above only compare the seven tables against each other, so
// a key referenced by the UI but defined in NONE of them was invisible: every
// language was equally missing it, and the `t.someKey || 'English fallback'`
// idiom used throughout hid the result from view. Two keys were live in the UI
// in exactly that state (conflictDetected, unknown).
describe('i18n keys referenced by the UI exist in the tables', () => {
  const COMPONENT_DIRS = ['components', 'tabs', 'hooks']

  // `t` is the translation prop in components, but a few modules use `t` as an
  // ordinary local (a theme object, a toast, a parser token). Those are not
  // translation lookups.
  const NOT_TRANSLATIONS = new Set(['id', 'startsWith', 'endsWith', 'slice', 'trim', 'length',
    'text', 'type', 'push', 'map', 'filter', 'replace', 'match', 'split', 'toLowerCase'])

  function collectFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) collectFiles(full, out)
      else if (/\.(js|jsx)$/.test(entry.name)) out.push(full)
    }
    return out
  }

  it('has no key used in the UI that is missing from every language', () => {
    const root = path.resolve('src/renderer/src')
    const files = COMPONENT_DIRS
      .map((d) => path.join(root, d))
      .filter((d) => fs.existsSync(d))
      .flatMap((d) => collectFiles(d))

    const known = new Set(Object.keys(UI_TEXT[REFERENCE_LANG]))
    const missing = new Map()

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf-8')
      for (const m of src.matchAll(/\bt\??\.([A-Za-z_$][\w$]*)/g)) {
        const key = m[1]
        if (NOT_TRANSLATIONS.has(key) || known.has(key)) continue
        if (!missing.has(key)) missing.set(key, path.relative(root, file))
      }
    }

    const report = [...missing].map(([k, f]) => `${k} (${f})`)
    expect(report, `translation keys used but defined in no language: ${report.join(', ')}`).toEqual([])
  })
})
