// BBCode → HTML converter for Nexus Mods descriptions.
//
// Nexus's v1 API returns mod descriptions in BBCode (not Markdown), so the
// HZMM detail modal runs text through here before handing it to
// dangerouslySetInnerHTML. The CSS class `.mod-readme` provides styling for
// the resulting HTML (headings, lists, blockquote, code, etc.).
//
// Design principles:
//   - HTML-escape the raw input first so BBCode content can't smuggle raw
//     HTML (Nexus users can put anything in description — we assume nothing).
//   - Iterate the rule pass until stable (handles nested tags).
//   - Block inline event handlers + unsafe URL schemes in [url] and [img].
//   - CSP blocks <iframe>, so [youtube] degrades to an external link.

const MAX_NEST_DEPTH = 20

function escapeHtml(input) {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Only allow http(s) and mailto. Anything else (javascript:, data:, file:) is
// rewritten to '#' so a click does nothing. Already-escaped quotes survive
// since we escapeHtml()'d the whole input up front.
function safeUrl(url) {
  if (!url) return '#'
  const trimmed = String(url).trim()
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed
  // Bare-ish domain (e.g. "example.com/path") → assume https
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(trimmed)) return 'https://' + trimmed
  return '#'
}

function extractYoutubeId(raw) {
  const s = String(raw).trim()
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:[^&]*&)*v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s
  return null
}

// BBCode "size" ranges from 1-7 in phpBB convention. Map to reasonable
// em multipliers: 1=0.7em, 4=1em (baseline), 7=1.6em.
function bbSizeToEm(n) {
  const clamped = Math.max(1, Math.min(7, parseInt(n, 10) || 4))
  return (0.5 + clamped * 0.15).toFixed(2) + 'em'
}

// Simple paired tag replacements — applied iteratively so nesting works.
// Format: [regex, replacement-or-fn]
const PAIRED_RULES = [
  [/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>'],
  [/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>'],
  [/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>'],
  [/\[s\]([\s\S]*?)\[\/s\]/gi, '<del>$1</del>'],
  [/\[center\]([\s\S]*?)\[\/center\]/gi, '<div style="text-align:center">$1</div>'],
  [/\[right\]([\s\S]*?)\[\/right\]/gi, '<div style="text-align:right">$1</div>'],
  [/\[left\]([\s\S]*?)\[\/left\]/gi, '<div style="text-align:left">$1</div>'],
  [/\[heading\]([\s\S]*?)\[\/heading\]/gi, '<h3>$1</h3>'],
  [/\[quote(?:=[^\]]*)?\]([\s\S]*?)\[\/quote\]/gi, '<blockquote>$1</blockquote>'],
  [/\[code\]([\s\S]*?)\[\/code\]/gi, '<pre><code>$1</code></pre>'],
  [/\[pre\]([\s\S]*?)\[\/pre\]/gi, '<pre>$1</pre>'],
  [/\[spoiler(?:=([^\]]+))?\]([\s\S]*?)\[\/spoiler\]/gi, (_m, label, body) =>
    `<details><summary>${label || 'Spoiler'}</summary>${body}</details>`],
]

// Nexus descriptions mix real HTML (<br />, <b>, <a href>, <p>, <li>…) into
// the BBCode soup. We rewrite a safe subset to BBCode equivalents BEFORE the
// escapeHtml step so they survive through to the output; everything else
// gets escaped to inert text. This keeps the parser's security model
// (escape-first) intact while still honoring what Nexus actually emits.
function preprocessHtmlToBbcode(input) {
  let s = String(input)
    // self-closing
    .replace(/<br\s*\/?>/gi, '[br]')
    .replace(/<hr\s*\/?>/gi, '[hr]')
    // paragraph: <p> opens, </p> doubles as a paragraph break
    .replace(/<p\s*\/?>/gi, '')
    .replace(/<\/p>/gi, '[br][br]')
    // inline emphasis
    .replace(/<(?:strong|b)>/gi, '[b]')
    .replace(/<\/(?:strong|b)>/gi, '[/b]')
    .replace(/<(?:em|i)>/gi, '[i]')
    .replace(/<\/(?:em|i)>/gi, '[/i]')
    .replace(/<u>/gi, '[u]')
    .replace(/<\/u>/gi, '[/u]')
    .replace(/<(?:del|s|strike)>/gi, '[s]')
    .replace(/<\/(?:del|s|strike)>/gi, '[/s]')
    // anchors — capture href, drop other attrs
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi, '[url=$1]')
    .replace(/<\/a>/gi, '[/url]')
    // lists
    .replace(/<ul[^>]*>/gi, '[list]')
    .replace(/<\/ul>/gi, '[/list]')
    .replace(/<ol[^>]*>/gi, '[list=1]')
    .replace(/<\/ol>/gi, '[/list]')
    .replace(/<li[^>]*>/gi, '[*]')
    .replace(/<\/li>/gi, '')
    // images — take src only
    .replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*\/?>/gi, '[img]$1[/img]')
  return s
}

export function bbcodeToHtml(input) {
  if (!input) return ''
  // 1) Convert recognized HTML tags → BBCode so the escape step below doesn't
  //    mangle them. Unknown/malformed HTML still gets escaped to inert text.
  // 2) Escape HTML entities — anything not in the whitelist above becomes
  //    harmless &lt; &gt; text.
  let s = escapeHtml(preprocessHtmlToBbcode(input))

  // Self-closing / standalone BBCode tags first
  s = s.replace(/\[br\]/gi, '<br>')
  s = s.replace(/\[hr\]/gi, '<hr>')
  s = s.replace(/\[line\]/gi, '<hr>')

  // Iterate paired tags — each pass unwraps one nesting level.
  for (let iter = 0; iter < MAX_NEST_DEPTH; iter++) {
    const before = s

    for (const [re, repl] of PAIRED_RULES) {
      s = s.replace(re, repl)
    }

    // [color=red]...[/color] — accept hex, named colors, or rgb(...)
    s = s.replace(/\[color=([#a-z0-9()\s,%.-]+)\]([\s\S]*?)\[\/color\]/gi,
      (_m, c, text) => `<span style="color:${c.trim()}">${text}</span>`)

    // [size=N]...[/size]
    s = s.replace(/\[size=(\d+)\]([\s\S]*?)\[\/size\]/gi,
      (_m, n, text) => `<span style="font-size:${bbSizeToEm(n)}">${text}</span>`)

    // [font=Arial, sans-serif]...[/font]
    s = s.replace(/\[font=([a-z0-9\s,'"-]+)\]([\s\S]*?)\[\/font\]/gi,
      (_m, f, text) => `<span style="font-family:${f.trim()}">${text}</span>`)

    // [url=https://...]text[/url]
    s = s.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi,
      (_m, url, text) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`)

    // [url]bare-link[/url] and autolinked urls
    s = s.replace(/\[url\]([\s\S]*?)\[\/url\]/gi,
      (_m, url) => {
        const u = safeUrl(url)
        return `<a href="${u}" target="_blank" rel="noopener noreferrer">${url}</a>`
      })

    // [email]addr@example.com[/email]
    s = s.replace(/\[email(?:=[^\]]*)?\]([\s\S]*?)\[\/email\]/gi,
      (_m, addr) => `<a href="mailto:${addr}">${addr}</a>`)

    // [img]https://...[/img] and [img width=N]...[/img]
    s = s.replace(/\[img(?:\s+[^\]]*)?\]([\s\S]*?)\[\/img\]/gi, (_m, url) => {
      const u = safeUrl(url)
      if (u === '#') return ''
      return `<img src="${u}" alt="" loading="lazy">`
    })

    // [youtube]ID_OR_URL[/youtube] — CSP blocks iframe embeds, link out instead
    s = s.replace(/\[youtube\]([\s\S]*?)\[\/youtube\]/gi, (_m, v) => {
      const id = extractYoutubeId(v)
      if (!id) return ''
      const url = `https://www.youtube.com/watch?v=${id}`
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">▶ YouTube: ${url}</a>`
    })

    // [list=1]...[*]...[/list] → <ol>; [list]...[*]...[/list] → <ul>
    s = s.replace(/\[list=1\]([\s\S]*?)\[\/list\]/gi, (_m, body) => {
      const items = body.split(/\[\*\]/).map(x => x.trim()).filter(Boolean)
      return `<ol>${items.map(i => `<li>${i}</li>`).join('')}</ol>`
    })
    s = s.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, (_m, body) => {
      const items = body.split(/\[\*\]/).map(x => x.trim()).filter(Boolean)
      return `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`
    })

    if (s === before) break
  }

  // Newline → <br>. Then collapse <br>s that hug block-level tags so we
  // don't end up with double spacing after lists/blockquotes.
  s = s.replace(/\r\n/g, '\n').replace(/\n/g, '<br>')
  s = s.replace(
    /<br>\s*(<(?:\/)?(?:blockquote|ul|ol|li|pre|h[1-6]|details|summary|hr|div)\b)/gi,
    '$1'
  )
  s = s.replace(
    /(<\/(?:blockquote|ul|ol|li|pre|h[1-6]|details|summary|div)>)\s*<br>/gi,
    '$1'
  )

  return s
}

export const _testInternals = { escapeHtml, safeUrl, extractYoutubeId, bbSizeToEm }
