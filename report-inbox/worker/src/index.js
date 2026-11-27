// HZMM problem-report inbox: a Cloudflare Worker that holds the reports
// players send from HZMM until the author's PC picks them up.
//
//   POST   /v1/reports        HZMM sends one gzipped report  → 201 { id }
//   GET    /v1/reports        list the waiting reports        (puller, signed)
//   GET    /v1/reports/<key>  one report, still gzipped       (puller, signed)
//   DELETE /v1/reports/<key>  drop it once saved on the PC    (puller, signed)
//
// Reports live in Workers KV for at most 30 days. The puller signs its
// requests with an Ed25519 key that never leaves the author's PC; this Worker
// only holds the public half (PULLER_PUBLIC_KEY). A new report pings the
// author's Discord channel when DISCORD_WEBHOOK_URL is set (a secret).
// Nothing here records who sent a report or from which IP address.

const MAX_BYTES = 512 * 1024
const KEEP_SECONDS = 30 * 24 * 60 * 60
const CLOCK_SKEW_SECONDS = 300
// Crockford base32: no I, L, O, U, so an id read aloud or retyped survives.
const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const KEY_RE = /^[0-9]{8}T[0-9]{6}-[0-9A-Z]{4}-[0-9A-Z]{4}$/
const SOURCES = new Set(['settings', 'error-toast', 'startup-error'])

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    try {
      if (url.pathname === '/v1/reports') {
        if (request.method === 'POST') return await submit(request, env, ctx)
        if (request.method === 'GET') return await signed(request, env, url, () => list(env))
        return text(405, 'Method not allowed')
      }
      const match = /^\/v1\/reports\/([^/]+)$/.exec(url.pathname)
      if (match && KEY_RE.test(match[1])) {
        if (request.method === 'GET') return await signed(request, env, url, () => fetchOne(env, match[1]))
        if (request.method === 'DELETE') return await signed(request, env, url, () => remove(env, match[1]))
        return text(405, 'Method not allowed')
      }
      return text(404, 'Not found')
    } catch {
      return text(500, 'Inbox error')
    }
  },
}

// --- receiving ------------------------------------------------------------

async function submit(request, env, ctx) {
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/gzip') return text(415, 'Expected application/gzip')
  const declared = Number(request.headers.get('Content-Length') || '0')
  if (declared > MAX_BYTES) return text(413, 'Report too large')
  const body = await readCapped(request, MAX_BYTES)
  if (!body) return text(413, 'Report too large')
  if (body.byteLength < 18 || body[0] !== 0x1f || body[1] !== 0x8b) return text(400, 'Not a gzip body')

  const id = newId()
  const receivedAt = new Date().toISOString()
  const key = `${receivedAt.replace(/[-:]/g, '').slice(0, 15)}-${id}`
  const summary = parseSummary(request.headers.get('X-HZMM-Summary'))
  await env.REPORTS.put(key, body, {
    expirationTtl: KEEP_SECONDS,
    metadata: { receivedAt, size: body.byteLength, ...summary },
  })
  if (env.DISCORD_WEBHOOK_URL) {
    ctx.waitUntil(notifyDiscord(env.DISCORD_WEBHOOK_URL, id, body.byteLength, summary).catch(() => {}))
  }
  return json(201, { id })
}

async function readCapped(request, limit) {
  if (!request.body) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const chars = Array.from(bytes, b => ID_ALPHABET[b & 31]).join('')
  return `${chars.slice(0, 4)}-${chars.slice(4)}`
}

// The one-line summary HZMM sends alongside the report: version, where it
// was sent from, the first line of the error. Anything odd is dropped.
function parseSummary(header) {
  let raw = {}
  try { raw = JSON.parse(decodeURIComponent(header || '')) } catch { /* no summary */ }
  if (!raw || typeof raw !== 'object') raw = {}
  const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '')
  const summary = {}
  const version = clean(raw.v, 20)
  if (/^[0-9A-Za-z.+-]+$/.test(version)) summary.version = version
  if (SOURCES.has(raw.src)) summary.source = raw.src
  const message = clean(raw.msg, 160)
  if (message) summary.message = message
  return summary
}

const SOURCE_LABELS = { settings: '設定頁', 'error-toast': '錯誤訊息', 'startup-error': '啟動失敗' }

async function notifyDiscord(webhook, id, size, summary) {
  const facts = [
    summary.version ? `HZMM ${summary.version}` : null,
    summary.source ? `來源：${SOURCE_LABELS[summary.source]}` : null,
    `${Math.max(1, Math.round(size / 1024))} KB`,
  ].filter(Boolean).join(' · ')
  const lines = [`📨 新的 HZMM 問題回報 \`${id}\``, facts]
  // The message comes from a player's machine: keep it inside a code block,
  // and allow no mentions at all, so it can't ping anyone or format itself.
  if (summary.message) lines.push('```', summary.message.replace(/`/g, "'"), '```')
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'HZMM 回報', content: lines.join('\n'), allowed_mentions: { parse: [] } }),
  })
  if (!res.ok) throw new Error(`Discord answered ${res.status}`)
}

// --- the puller's side ------------------------------------------------------

async function signed(request, env, url, handler) {
  if (!env.PULLER_PUBLIC_KEY) return text(503, 'Inbox not set up')
  const time = request.headers.get('X-Puller-Time') || ''
  const signature = request.headers.get('X-Puller-Signature') || ''
  const now = Math.floor(Date.now() / 1000)
  if (!/^[0-9]{9,11}$/.test(time) || Math.abs(now - Number(time)) > CLOCK_SKEW_SECONDS) return text(401, 'Unauthorized')
  const message = `${request.method}\n${url.pathname}\n${time}`
  if (!(await verifySignature(env.PULLER_PUBLIC_KEY, message, signature))) return text(401, 'Unauthorized')
  return handler()
}

async function verifySignature(publicKeyBase64, message, signatureBase64) {
  try {
    const key = await crypto.subtle.importKey('raw', fromBase64(publicKeyBase64), { name: 'Ed25519' }, false, ['verify'])
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, fromBase64(signatureBase64), new TextEncoder().encode(message))
  } catch {
    return false
  }
}

async function list(env) {
  const reports = []
  let cursor
  do {
    const page = await env.REPORTS.list({ cursor, limit: 1000 })
    for (const k of page.keys) reports.push({ key: k.name, ...(k.metadata || {}) })
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return json(200, { reports })
}

async function fetchOne(env, key) {
  const body = await env.REPORTS.get(key, 'arrayBuffer')
  if (body === null) return text(404, 'No such report')
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store' } })
}

async function remove(env, key) {
  await env.REPORTS.delete(key)
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}

// --- helpers ------------------------------------------------------------------

function fromBase64(s) {
  const bin = atob(String(s).trim())
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}

function json(status, value) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

function text(status, message) {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}
