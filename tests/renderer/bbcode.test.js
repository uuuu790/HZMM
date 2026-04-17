import { describe, it, expect } from 'vitest'
import { bbcodeToHtml, _testInternals } from '../../src/renderer/src/utils/bbcode.js'

const { safeUrl, extractYoutubeId, escapeHtml, bbSizeToEm } = _testInternals

describe('bbcode escapeHtml', () => {
  it('escapes the five dangerous characters', () => {
    expect(escapeHtml('<script>alert("x")</script>'))
      .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
  })
  it('handles empty / non-string gracefully', () => {
    expect(escapeHtml('')).toBe('')
    expect(escapeHtml(123)).toBe('123')
  })
})

describe('bbcode safeUrl', () => {
  it('allows http, https, mailto', () => {
    expect(safeUrl('https://example.com')).toBe('https://example.com')
    expect(safeUrl('http://example.com')).toBe('http://example.com')
    expect(safeUrl('mailto:a@b.com')).toBe('mailto:a@b.com')
  })
  it('rewrites javascript: to #', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#')
    expect(safeUrl('JavaScript:alert(1)')).toBe('#')
  })
  it('rewrites data: and file: to #', () => {
    expect(safeUrl('data:text/html,<script>')).toBe('#')
    expect(safeUrl('file:///c:/secret')).toBe('#')
  })
  it('auto-prefixes bare domains with https', () => {
    expect(safeUrl('example.com/foo')).toBe('https://example.com/foo')
  })
  it('returns # for empty/null', () => {
    expect(safeUrl('')).toBe('#')
    expect(safeUrl(null)).toBe('#')
  })
})

describe('bbcode extractYoutubeId', () => {
  it('parses standard watch URLs', () => {
    expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('parses shortened youtu.be URLs', () => {
    expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('parses embed URLs', () => {
    expect(extractYoutubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('accepts bare 11-char IDs', () => {
    expect(extractYoutubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
  it('returns null for garbage', () => {
    expect(extractYoutubeId('hello')).toBeNull()
    expect(extractYoutubeId('')).toBeNull()
  })
})

describe('bbcode bbSizeToEm', () => {
  it('clamps values above 7', () => {
    expect(bbSizeToEm(99)).toBe(bbSizeToEm(7))
  })
  it('defaults unparseable values to 4 (baseline)', () => {
    // 0 is falsy → `|| 4` kicks in. That's intentional — BBCode has no size 0.
    expect(bbSizeToEm(0)).toBe(bbSizeToEm(4))
    expect(bbSizeToEm('garbage')).toBe(bbSizeToEm(4))
  })
  it('produces em-suffixed strings', () => {
    expect(bbSizeToEm(4)).toMatch(/em$/)
  })
  it('1 → smallest, 7 → largest', () => {
    const sizes = [1, 2, 3, 4, 5, 6, 7].map(n => parseFloat(bbSizeToEm(n)))
    // Monotonically increasing
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1])
  })
})

describe('bbcodeToHtml — basic tags', () => {
  it('converts bold / italic / underline', () => {
    expect(bbcodeToHtml('[b]bold[/b]')).toContain('<strong>bold</strong>')
    expect(bbcodeToHtml('[i]italic[/i]')).toContain('<em>italic</em>')
    expect(bbcodeToHtml('[u]under[/u]')).toContain('<u>under</u>')
  })

  it('handles nested tags', () => {
    const out = bbcodeToHtml('[b][i]both[/i][/b]')
    expect(out).toContain('<strong>')
    expect(out).toContain('<em>')
    expect(out.indexOf('<strong>')).toBeLessThan(out.indexOf('<em>'))
  })

  it('is case insensitive', () => {
    expect(bbcodeToHtml('[B]x[/B]')).toContain('<strong>x</strong>')
  })

  it('converts URL tag with text', () => {
    const out = bbcodeToHtml('[url=https://example.com]link[/url]')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
    expect(out).toContain('>link<')
  })

  it('converts bare URL tag', () => {
    const out = bbcodeToHtml('[url]https://example.com[/url]')
    expect(out).toContain('href="https://example.com"')
  })

  it('blocks javascript: in [url]', () => {
    const out = bbcodeToHtml('[url=javascript:alert(1)]click[/url]')
    expect(out).toContain('href="#"')
    expect(out).not.toContain('javascript:')
  })

  it('produces <img> with loading=lazy', () => {
    const out = bbcodeToHtml('[img]https://x.com/a.png[/img]')
    expect(out).toContain('<img')
    expect(out).toContain('loading="lazy"')
    expect(out).toContain('src="https://x.com/a.png"')
  })

  it('drops [img] with unsafe URL', () => {
    expect(bbcodeToHtml('[img]javascript:1[/img]')).toBe('')
  })

  it('converts [youtube] to external link (CSP blocks iframe)', () => {
    const out = bbcodeToHtml('[youtube]dQw4w9WgXcQ[/youtube]')
    expect(out).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"')
    expect(out).not.toContain('<iframe')
  })

  it('renders unordered list', () => {
    const out = bbcodeToHtml('[list][*]one[*]two[/list]')
    expect(out).toContain('<ul>')
    expect(out).toContain('<li>one</li>')
    expect(out).toContain('<li>two</li>')
  })

  it('renders ordered list with [list=1]', () => {
    const out = bbcodeToHtml('[list=1][*]one[*]two[/list]')
    expect(out).toContain('<ol>')
  })

  it('renders spoiler as <details>', () => {
    const out = bbcodeToHtml('[spoiler]hidden[/spoiler]')
    expect(out).toContain('<details>')
    expect(out).toContain('<summary>Spoiler</summary>')
    expect(out).toContain('hidden')
  })

  it('renders spoiler with custom label', () => {
    const out = bbcodeToHtml('[spoiler=Click me]body[/spoiler]')
    expect(out).toContain('<summary>Click me</summary>')
  })

  it('renders quote as blockquote', () => {
    expect(bbcodeToHtml('[quote]said[/quote]')).toContain('<blockquote>said</blockquote>')
  })

  it('renders code as <pre><code>', () => {
    const out = bbcodeToHtml('[code]let x = 1[/code]')
    expect(out).toContain('<pre><code>let x = 1</code></pre>')
  })

  it('converts newlines to <br>', () => {
    expect(bbcodeToHtml('line one\nline two')).toContain('line one<br>line two')
  })

  it('suppresses <br> adjacent to block tags', () => {
    const out = bbcodeToHtml('before\n[quote]q[/quote]\nafter')
    expect(out).not.toMatch(/<br>\s*<blockquote/)
    expect(out).not.toMatch(/<\/blockquote>\s*<br>/)
  })
})

describe('bbcodeToHtml — security', () => {
  it('escapes raw HTML in plain text', () => {
    const out = bbcodeToHtml('<script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('escapes raw HTML inside BBCode content', () => {
    const out = bbcodeToHtml('[b]<script>alert(1)</script>[/b]')
    expect(out).not.toContain('<script>')
    expect(out).toContain('<strong>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('prevents attribute injection via quotes in [img]', () => {
    // An attacker embeds `"` in the URL to try to break out of src="..." and
    // inject onerror=. escapeHtml runs FIRST (before BBCode parsing), so every
    // `"` becomes `&quot;` and the injection becomes inert content inside the
    // src value — the browser parses it as a single malformed URL with no
    // separate onerror attribute.
    const out = bbcodeToHtml('[img]https://x.com/a.png" onerror="alert(1)[/img]')
    expect(out).toContain('&quot;')           // injected quote got escaped
    expect(out).not.toContain('" onerror="')  // no real attribute break-out
  })
})

describe('bbcodeToHtml — edge cases', () => {
  it('returns empty string for null / empty', () => {
    expect(bbcodeToHtml(null)).toBe('')
    expect(bbcodeToHtml(undefined)).toBe('')
    expect(bbcodeToHtml('')).toBe('')
  })

  it('leaves unknown tags as escaped text', () => {
    const out = bbcodeToHtml('[unknown]x[/unknown]')
    expect(out).toContain('[unknown]')
    expect(out).toContain('[/unknown]')
  })

  it('does not infinite-loop on malformed nesting', () => {
    // Deliberately unbalanced — should terminate and just render what it can.
    const out = bbcodeToHtml('[b]a[i]b[/b]c[/i]')
    expect(out).toBeTruthy()
    expect(out.length).toBeLessThan(1000)
  })
})
