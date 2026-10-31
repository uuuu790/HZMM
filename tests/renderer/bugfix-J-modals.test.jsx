// @vitest-environment jsdom
// jsdom, not happy-dom: ModDetailModal and NexusModDetailModal render through
// DOMPurify, which stops sanitizing under happy-dom (see bbcode.test.js).
//
// Regression tests for the J-modals bug-fix cluster: modal races / state,
// README rendering, Nexus file dates, BBCode lists and [email], i18n strings.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import NexusLinkModal from '../../src/renderer/src/components/modals/NexusLinkModal.jsx'
import NexusModDetailModal from '../../src/renderer/src/components/modals/NexusModDetailModal.jsx'
import ModDetailModal from '../../src/renderer/src/components/modals/ModDetailModal.jsx'
import PreviewModal from '../../src/renderer/src/components/modals/PreviewModal.jsx'
import { bbcodeToHtml, _testInternals } from '../../src/renderer/src/utils/bbcode'
import { nexusTimeMs } from '../../src/renderer/src/utils/nexus-mod-adapt'
import { UI_TEXT } from '../../src/renderer/src/constants/i18n/index.js'

const { bbcodeToRawHtml } = _testInternals

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted = []
function mount(node) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => root.render(node))
  mounted.push({ root, el })
  return { el, root, rerender: (n) => act(() => root.render(n)) }
}
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}
const buttonsByText = (text) => [...document.querySelectorAll('button')].filter(b => b.textContent.includes(text))

afterEach(() => {
  for (const { root, el } of mounted.splice(0)) {
    act(() => root.unmount())
    el.remove()
  }
  document.body.innerHTML = ''
  delete window.api
  vi.restoreAllMocks()
})

const en = UI_TEXT.en
const zh = UI_TEXT['zh-TW']

// ── NexusLinkModal ──────────────────────────────────────────────────────

describe('NexusLinkModal — stale responses (gid 113)', () => {
  const linkMod = { filename: 'Thing_P.pak', title: 'Thing' }

  it('a late file list for a previously picked mod does not replace the current pick', async () => {
    const filesA = deferred()
    const linkModFn = vi.fn().mockResolvedValue({ ok: true })
    window.api = {
      nexus: {
        searchMods: vi.fn().mockResolvedValue({ ok: true, mods: [{ modId: 1, name: 'ModA' }, { modId: 2, name: 'ModB' }] }),
        getModFiles: vi.fn((id) => id === 1
          ? filesA.promise
          : Promise.resolve({ ok: true, files: [{ file_id: 200, name: 'B-file', version: '2.0' }] })),
        linkMod: linkModFn,
      },
    }
    mount(<NexusLinkModal isOpen mod={linkMod} onClose={() => {}} addToast={() => {}} t={en} />)
    await flush()

    act(() => buttonsByText('ModA')[0].click())
    act(() => buttonsByText('ModA')[0].click()) // the back chip shows the picked mod's name
    act(() => buttonsByText('ModB')[0].click())
    await flush()
    expect(document.body.textContent).toContain('B-file')

    await act(async () => { filesA.resolve({ ok: true, files: [{ file_id: 100, name: 'A-file', version: '1.0' }] }) })
    await flush()
    expect(document.body.textContent).toContain('B-file')
    expect(document.body.textContent).not.toContain('A-file')

    act(() => buttonsByText('B-file')[0].click())
    await flush()
    expect(linkModFn).toHaveBeenCalledWith(2, 'Thing_P.pak', 200, '2.0')
  })

  it('the auto-search seeded on open cannot overwrite a newer search', async () => {
    const seed = deferred()
    window.api = {
      nexus: {
        searchMods: vi.fn((q) => q === 'Thing'
          ? seed.promise
          : Promise.resolve({ ok: true, mods: [{ modId: 9, name: 'Right' }] })),
        getModFiles: vi.fn(),
        linkMod: vi.fn(),
      },
    }
    mount(<NexusLinkModal isOpen mod={linkMod} onClose={() => {}} addToast={() => {}} t={en} />)
    await flush()

    const input = document.querySelector('input[type="text"]')
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    act(() => {
      setValue.call(input, 'better')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    await flush()
    expect(document.body.textContent).toContain('Right')

    await act(async () => { seed.resolve({ ok: true, mods: [{ modId: 5, name: 'Stale' }] }) })
    await flush()
    expect(document.body.textContent).toContain('Right')
    expect(document.body.textContent).not.toContain('Stale')
  })
})

describe('NexusLinkModal — file dates (gids 121, 138)', () => {
  it('renders V2 ISO upload dates instead of "Invalid Date"', async () => {
    const iso = '2026-04-17T15:31:48Z'
    window.api = {
      nexus: {
        searchMods: vi.fn().mockResolvedValue({ ok: true, mods: [{ modId: 3, name: 'BP' }] }),
        getModFiles: vi.fn().mockResolvedValue({ ok: true, files: [{ file_id: 7, name: 'Backpack', version: '1.0', uploaded_timestamp: iso }] }),
        linkMod: vi.fn(),
      },
    }
    mount(<NexusLinkModal isOpen mod={{ filename: 'BP_P.pak', title: 'BP' }} onClose={() => {}} addToast={() => {}} t={en} />)
    await flush()
    act(() => buttonsByText('BP')[0].click())
    await flush()
    const row = buttonsByText('Backpack')[0]
    expect(row.textContent).not.toContain('Invalid Date')
    expect(row.textContent).toContain(new Date(iso).toLocaleDateString())
  })
})

// ── NexusModDetailModal ─────────────────────────────────────────────────

describe('NexusModDetailModal', () => {
  function setupApi(detail, files) {
    window.api = {
      nexus: {
        getModDetail: vi.fn().mockResolvedValue({ ok: true, mod: detail }),
        getModFiles: vi.fn().mockResolvedValue({ ok: true, files }),
        installFile: vi.fn(),
      },
      system: { openExternal: vi.fn() },
    }
  }
  const props = (t) => ({ mod: { modId: 42, name: 'Thing' }, t, onClose: () => {}, addToast: () => {}, isPremium: true, installedSet: new Set(), installedList: [] })

  it('lists files newest-first with V2 ISO timestamps (gids 120, 139)', async () => {
    setupApi({ modId: 42, name: 'Thing', description: 'desc' }, [
      { file_id: 1, name: 'old', category_id: 1, uploaded_timestamp: '2024-01-01T00:00:00Z' },
      { file_id: 2, name: 'newest', category_id: 1, uploaded_timestamp: '2026-01-01T00:00:00Z' },
      { file_id: 3, name: 'middle', category_id: 1, uploaded_timestamp: '2025-01-01T00:00:00Z' },
    ])
    mount(<NexusModDetailModal {...props(en)} />)
    await flush()
    act(() => buttonsByText(en.nexusFiles)[0].click())
    const names = [...document.querySelectorAll('span.font-bold.truncate')].map(s => s.textContent)
    expect(names).toEqual(['newest', 'middle', 'old'])
  })

  it('shows a translated placeholder for an empty description (gids 129, 147)', async () => {
    setupApi({ modId: 42, name: 'Thing' }, [])
    mount(<NexusModDetailModal {...props(zh)} />)
    await flush()
    const p = document.querySelector('p.italic')
    expect(p.textContent).toBe(zh.nexusNoDescription)
    expect(p.textContent).not.toBe('No description.')
  })
})

// ── ModDetailModal ──────────────────────────────────────────────────────

describe('ModDetailModal', () => {
  const baseMod = { filename: 'CoolMod', type: 'UE4SS', title: 'CoolMod', enabled: true }
  function setupApi(content) {
    const getReadme = vi.fn().mockResolvedValue({ content, filename: 'README.md' })
    window.api = { mods: { getReadme, getConfigFiles: vi.fn().mockResolvedValue([]) }, system: { openExternal: vi.fn() } }
    return getReadme
  }
  async function render(content, lang = 'en') {
    const getReadme = setupApi(content)
    const view = mount(<ModDetailModal isOpen mod={{ ...baseMod }} onClose={() => {}} onOpenConfig={() => {}} t={UI_TEXT[lang]} lang={lang} />)
    await flush(); await flush()
    return { ...view, getReadme, readme: document.querySelector('.mod-readme') }
  }

  it('asks main for the README in the UI language (gids 114, 141)', async () => {
    const { getReadme } = await render('# x\n\nhi', 'zh-TW')
    expect(getReadme).toHaveBeenCalledWith('CoolMod', 'zh-TW')
  })

  it('treats ordinary 【…】 headings as content, not language sections (gid 115)', async () => {
    const { readme } = await render('# 我的模組\n\n這是簡介。\n\n【安裝】\n把資料夾放進 Mods。\n\n【設定】\n編輯 config.lua。\n\n【注意事項】\n不要和其他背包模組一起用。\n', 'zh-TW')
    const text = readme.textContent
    for (const part of ['我的模組', '這是簡介。', '【安裝】', '把資料夾放進 Mods。', '【設定】', '編輯 config.lua。', '【注意事項】', '不要和其他背包模組一起用。']) {
      expect(text).toContain(part)
    }
  })

  it('keeps a 【注意】 sub-heading inside its language section (gid 115)', async () => {
    const { readme } = await render('【繁體中文】\n說明\n【注意】不要混用\n更多中文\n\n【English】\nEnglish text', 'zh-TW')
    const text = readme.textContent
    expect(text).toContain('說明')
    expect(text).toContain('【注意】不要混用')
    expect(text).toContain('更多中文')
    expect(text).not.toContain('English text')
  })

  it('ends a section at a language the app has no locale for (gid 115 follow-up)', async () => {
    const { readme } = await render('【English】\nEnglish text\n\n【Español】\nTexto en español\n\n【繁體中文】\n中文說明', 'en')
    const text = readme.textContent
    expect(text).toContain('English text')
    expect(text).not.toContain('Español')
    expect(text).not.toContain('Texto en español')
    expect(text).not.toContain('中文說明')
  })

  it('does not append an unsupported-language section to the Chinese one (gid 115 follow-up)', async () => {
    const { readme } = await render('【繁體中文】\n中文說明\n\n【Polski】\nPolski tekst\n\n【English】\nEnglish text', 'zh-TW')
    const text = readme.textContent
    expect(text).toContain('中文說明')
    expect(text).not.toContain('Polski tekst')
    expect(text).not.toContain('English text')
  })

  const upperCaseLabels = '【繁體中文】\n中文說明\n\n【ENGLISH】\nEnglish text'
  it('counts an upper-case 【ENGLISH】 marker as a section boundary (gid 115 follow-up)', async () => {
    const text = (await render(upperCaseLabels, 'zh-TW')).readme.textContent
    expect(text).toContain('中文說明')
    expect(text).not.toContain('English text')
  })

  it('picks an upper-case 【ENGLISH】 section for an English UI (gid 115 follow-up)', async () => {
    const text = (await render(upperCaseLabels, 'en')).readme.textContent
    expect(text).toContain('English text')
    expect(text).not.toContain('中文說明')
  })

  it('prefers a 繁體中文 section over a 简体中文 one for zh-TW (gid 115 follow-up)', async () => {
    const { readme } = await render('【简体中文】\n简体说明\n\n【繁體中文】\n繁體說明\n\n【English】\nEnglish text', 'zh-TW')
    const text = readme.textContent
    expect(text).toContain('繁體說明')
    expect(text).not.toContain('简体说明')
    expect(text).not.toContain('English text')
  })

  it('renders inline code verbatim (gid 118)', async () => {
    const { readme } = await render('# Install\n\nCopy into `<GameDir>\\HumanitZ\\Content\\Paks\\~mods` and enable `my_mod_name*x*`.')
    expect(readme.textContent).toContain('<GameDir>\\HumanitZ\\Content\\Paks\\~mods')
    expect(readme.textContent).toContain('my_mod_name*x*')
    expect(readme.querySelectorAll('code').length).toBe(2)
    expect(readme.querySelector('em')).toBeNull()
  })

  it('keeps prose above the first heading and ignores "#" lines inside fences (gid 119)', async () => {
    const { readme } = await render('Better Backpacks v2\nRequires UE4SS 3.0.1 or newer!\n\nEdit the multiplier:\n```lua\n# not lua but people paste shell too\nMultiplier = 2\n```\nThanks!')
    expect(readme.textContent).toContain('Requires UE4SS 3.0.1 or newer!')
    expect(readme.querySelector('h1')).toBeNull()
    const pres = readme.querySelectorAll('pre')
    expect(pres.length).toBe(1)
    expect(pres[0].textContent).toContain('# not lua but people paste shell too')
    expect(pres[0].textContent).not.toContain('Thanks!')
    expect(readme.textContent).toContain('Thanks!')
  })

  it('keeps a requirement line written above the first heading (gid 119)', async () => {
    const { readme } = await render('Requires UE4SS 3.0.1!\n\n# Title\n\nbody')
    expect(readme.textContent).toContain('Requires UE4SS 3.0.1!')
    expect(readme.querySelector('h1').textContent).toBe('Title')
  })

  it('does not refetch or unmount when the mods list hands in a new but equal mod object (gid 127)', async () => {
    const getReadme = setupApi('# Title\n\nbody')
    const el = (mod) => <ModDetailModal isOpen mod={mod} onClose={() => {}} onOpenConfig={() => {}} t={en} lang="en" />
    const view = mount(el({ ...baseMod }))
    await flush(); await flush()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    view.rerender(el({ ...baseMod }))
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await flush()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(getReadme).toHaveBeenCalledTimes(1)
  })
})

// ── PreviewModal ────────────────────────────────────────────────────────

describe('PreviewModal "Don\'t show again" (gid 126)', () => {
  const previews = [{ fileName: 'x.zip', type: 'pak-only', mods: [] }]
  function renderPreview() {
    const onDontShowAgain = vi.fn()
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    const view = mount(<PreviewModal isOpen onClose={onClose} previews={previews} loading={false} onConfirm={onConfirm} onDontShowAgain={onDontShowAgain} t={en} />)
    const box = () => document.querySelector('input[type="checkbox"]')
    const confirm = () => buttonsByText(en.previewConfirm)[0]
    return { view, onDontShowAgain, onConfirm, onClose, box, confirm }
  }

  it('unticking the box before confirming leaves the preview on', () => {
    const { onDontShowAgain, onConfirm, box, confirm } = renderPreview()
    act(() => box().click())
    act(() => box().click())
    expect(box().checked).toBe(false)
    act(() => confirm().click())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onDontShowAgain).not.toHaveBeenCalled()
  })

  it('confirming with the box ticked turns the preview off', () => {
    const { onDontShowAgain, onConfirm, box, confirm } = renderPreview()
    act(() => box().click())
    expect(box().checked).toBe(true)
    expect(onDontShowAgain).not.toHaveBeenCalled()
    act(() => confirm().click())
    expect(onDontShowAgain).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('cancelling with the box ticked does not save it, and reopening starts unticked', () => {
    const { view, onDontShowAgain, onConfirm, onClose, box } = renderPreview()
    act(() => box().click())
    act(() => document.querySelector('button[aria-label]').click())
    expect(onClose).toHaveBeenCalled()
    expect(onDontShowAgain).not.toHaveBeenCalled()
    const props = { onClose, previews, loading: false, onConfirm, onDontShowAgain, t: en }
    view.rerender(<PreviewModal isOpen={false} {...props} />)
    view.rerender(<PreviewModal isOpen {...props} />)
    expect(box().checked).toBe(false)
  })
})

// ── BBCode ──────────────────────────────────────────────────────────────

describe('bbcode lists (gids 122, 123)', () => {
  it('nests a [list] inside a [list] item', () => {
    expect(bbcodeToHtml('[list][*]a[list][*]b[/list][*]c[/list]'))
      .toBe('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>')
  })

  it('keeps every item of a [list=1] with a nested [list] inside the <ol>', () => {
    expect(bbcodeToHtml('[list=1][*]one[list][*]sub[/list][*]two[/list]'))
      .toBe('<ol><li>one<ul><li>sub</li></ul></li><li>two</li></ol>')
  })

  it('handles nested lists written on separate lines', () => {
    expect(bbcodeToHtml('[list]\n[*]a\n[list]\n[*]b\n[/list]\n[*]c\n[/list]\nAfter'))
      .toBe('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>After')
  })

  it('ends a bare [*] run at a blank line', () => {
    const out = bbcodeToRawHtml('Features:\n[*]Alpha\n[*]Beta\n\nInstallation: put the pak in ~mods.')
    expect(out).toContain('<ul><li>Alpha</li><li>Beta</li></ul>')
    expect(out.indexOf('Installation')).toBeGreaterThan(out.indexOf('</ul>'))
  })

  it('ends a bare [*] run at a <br><br> paragraph break', () => {
    const out = bbcodeToRawHtml('[*]Alpha<br />[*]Beta<br /><br />[b]Install[/b] here')
    expect(out).toContain('<ul><li>Alpha</li><li>Beta</li></ul>')
    expect(out.indexOf('<strong>Install</strong>')).toBeGreaterThan(out.indexOf('</ul>'))
  })
})

describe('bbcode [email] (gid 125)', () => {
  it('links the attribute form to the address, labelled with the text', () => {
    const out = bbcodeToHtml('[email=me@example.com]Contact me[/email]')
    expect(out).toBe('<a href="mailto:me@example.com">Contact me</a>')
  })
  it('still links the bare form to its text', () => {
    expect(bbcodeToHtml('[email]me@example.com[/email]')).toBe('<a href="mailto:me@example.com">me@example.com</a>')
  })
})

// ── helpers / i18n ──────────────────────────────────────────────────────

describe('nexusTimeMs', () => {
  it('accepts V2 ISO strings and V1 unix seconds', () => {
    expect(nexusTimeMs('2026-04-17T15:31:48Z')).toBe(Date.parse('2026-04-17T15:31:48Z'))
    expect(nexusTimeMs(1700000000)).toBe(1700000000 * 1000)
  })
  it('returns 0 for missing or unparseable values', () => {
    expect(nexusTimeMs(undefined)).toBe(0)
    expect(nexusTimeMs(null)).toBe(0)
    expect(nexusTimeMs('garbage')).toBe(0)
  })
})

describe('i18n strings', () => {
  it('zh-TW nexusPremiumRequired names Premium (gid 146)', () => {
    expect(zh.nexusPremiumRequired).toContain('Premium')
  })
  it('every locale has a nexusNoDescription string (gids 129, 147)', () => {
    for (const lang of Object.keys(UI_TEXT)) expect(UI_TEXT[lang].nexusNoDescription, lang).toBeTruthy()
  })
})
