// Fail-closed wrapper around DOMPurify.
//
// DOMPurify FAILS OPEN by design: when it decides the environment has no usable
// DOM (`DOMPurify.isSupported === false`) `sanitize()` returns its input
// verbatim, unchanged. Every caller in this app feeds the result straight to
// `dangerouslySetInnerHTML` with mod-authored or Nexus-authored markup, so an
// open failure is a full XSS with `window.api` in reach.
//
// That is not hypothetical: DOMPurify also degrades silently on a DOM that is
// merely *incomplete* rather than absent. The test suite hit exactly this —
// under happy-dom, `sanitize()` returned `<script>` untouched for any input
// with leading text — which is why the DOM-backed tests now run on jsdom.
//
// So: check support explicitly and escape the markup instead of passing it
// through. The user still sees the content, inert, and we log once.

import DOMPurify from 'dompurify'

let warned = false

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function sanitizeHtml(dirty, config) {
  if (!DOMPurify.isSupported) {
    if (!warned) {
      warned = true
      console.error(
        '[sanitize] DOMPurify reports no usable DOM — rendering untrusted content as escaped text instead of HTML'
      )
    }
    return escapeHtml(dirty)
  }
  return DOMPurify.sanitize(dirty, config)
}
