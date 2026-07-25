// README rendering pipeline — markdown → HTML → DOMPurify.
//
// README content comes from untrusted mod authors and is handed to
// dangerouslySetInnerHTML, so a raw <script>/<img onerror> embedded in a
// README.md would run with full window.api access (filesystem, install,
// settings, …) if it were rendered unsanitized. The production CSP
// (script-src 'self', no unsafe-inline/unsafe-eval — see renderer/index.html)
// is the second line of defence, not the first: this sanitizer is the first.
//
// DOMPurify strips script/iframe/embed/object/form/input/style/link/meta
// tags, all event-handler attributes, and javascript:/data: URLs while
// preserving the markdown elements marked emits (p/a/ul/li/code/pre/h*/
// img/blockquote/table).
//
// sanitizeHtml (not DOMPurify.sanitize) so a DOM that DOMPurify considers
// unusable escapes the markup instead of passing it through — see purify-guard.

import { marked } from 'marked';
import { sanitizeHtml } from './purify-guard';

const PURIFY_CONFIG = {
  FORBID_TAGS: ['script', 'iframe', 'embed', 'object', 'form', 'input', 'style', 'link', 'meta'],
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

export function sanitizeReadme(markdownText) {
  if (!markdownText) return '';
  return sanitizeHtml(marked.parse(markdownText, { breaks: true }), PURIFY_CONFIG);
}
