import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import zlib from 'zlib'
import worker from '../../report-inbox/worker/src/index.js'

// The report inbox Worker, run in Node against an in-memory KV: anyone can
// drop a report in (gzip only, size-capped), only the author's puller —
// holding the Ed25519 key — can list, fetch and delete them.

function fakeKV() {
  const entries = new Map()
  return {
    entries,
    async put(key, value, opts) {
      entries.set(key, { value: new Uint8Array(value), metadata: opts?.metadata ?? null, ttl: opts?.expirationTtl })
    },
    async get(key, type) {
      const e = entries.get(key)
      if (!e) return null
      return type === 'arrayBuffer' ? e.value.slice().buffer : new TextDecoder().decode(e.value)
    },
    async list() {
      const keys = [...entries.keys()].sort().map(name => ({ name, metadata: entries.get(name).metadata }))
      return { keys, list_complete: true }
    },
    async delete(key) { entries.delete(key) },
  }
}

let keys, publicKey, env, waited
beforeAll(async () => {
  keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  publicKey = Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey)).toString('base64')
})

beforeEach(() => {
  env = { REPORTS: fakeKV(), PULLER_PUBLIC_KEY: publicKey }
  waited = []
})

afterEach(() => { vi.unstubAllGlobals() })

const ctx = () => ({ waitUntil: (p) => waited.push(p) })
const BASE = 'https://hzmm-reports.example.workers.dev'

function report(payload = { format: 1, note: 'hi' }) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(payload)))
}

function post(body, headers = {}) {
  return worker.fetch(new Request(`${BASE}/v1/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/gzip', ...headers },
    body,
  }), env, ctx())
}

async function signedRequest(method, path, { time = Math.floor(Date.now() / 1000), signWith = keys.privateKey, tamper = false } = {}) {
  const message = `${method}\n${path}\n${time}`
  let sig = Buffer.from(await crypto.subtle.sign({ name: 'Ed25519' }, signWith, new TextEncoder().encode(message)))
  if (tamper) sig[0] ^= 1
  return worker.fetch(new Request(`${BASE}${path}`, {
    method,
    headers: { 'X-Puller-Time': String(time), 'X-Puller-Signature': sig.toString('base64') },
  }), env, ctx())
}

describe('receiving a report', () => {
  it('stores a gzipped report for 30 days and answers with its id', async () => {
    const summary = encodeURIComponent(JSON.stringify({ v: '1.8.0', src: 'error-toast', msg: '安裝失敗：boom' }))
    const res = await post(report(), { 'X-HZMM-Summary': summary })
    expect(res.status).toBe(201)
    const { id } = await res.json()
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
    const [[key, entry]] = [...env.REPORTS.entries]
    expect(key).toMatch(new RegExp(`^\\d{8}T\\d{6}-${id}$`))
    expect(entry.ttl).toBe(30 * 24 * 60 * 60)
    expect(entry.metadata).toMatchObject({ version: '1.8.0', source: 'error-toast', message: '安裝失敗：boom', size: entry.value.byteLength })
    expect(JSON.parse(zlib.gunzipSync(Buffer.from(entry.value)).toString())).toEqual({ format: 1, note: 'hi' })
  })

  it('refuses anything that is not a small gzip body', async () => {
    expect((await post(report(), { 'Content-Type': 'application/json' })).status).toBe(415)
    expect((await post(Buffer.from('not gzip at all, just text'))).status).toBe(400)
    expect((await post(Buffer.alloc(600 * 1024, 0x1f))).status).toBe(413)
    expect(env.REPORTS.entries.size).toBe(0)
  })

  it('drops a malformed summary instead of failing the report', async () => {
    const res = await post(report(), { 'X-HZMM-Summary': '%E0%A4%A' })
    expect(res.status).toBe(201)
    const [entry] = env.REPORTS.entries.values()
    expect(Object.keys(entry.metadata).sort()).toEqual(['receivedAt', 'size'])
  })

  it('pings Discord without letting the message mention anyone', async () => {
    const calls = []
    vi.stubGlobal('fetch', async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 204 }) })
    env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1/abc'
    const summary = encodeURIComponent(JSON.stringify({ v: '1.8.0', src: 'startup-error', msg: '@everyone `boom`' }))
    const res = await post(report(), { 'X-HZMM-Summary': summary })
    await Promise.all(waited)
    expect(res.status).toBe(201)
    expect(calls).toHaveLength(1)
    const body = JSON.parse(calls[0].init.body)
    expect(body.allowed_mentions).toEqual({ parse: [] })
    expect(body.content).toContain('啟動失敗')
    expect(body.content).toContain("@everyone 'boom'")
    expect(body.content).toContain((await res.json()).id)
  })

  it('a failing Discord webhook does not fail the report', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1/abc'
    const res = await post(report())
    await Promise.all(waited)
    expect(res.status).toBe(201)
  })
})

describe('the puller', () => {
  it('lists, fetches and deletes with a valid signature', async () => {
    await post(report({ format: 1, note: 'one' }))
    const listed = await signedRequest('GET', '/v1/reports')
    expect(listed.status).toBe(200)
    const { reports } = await listed.json()
    expect(reports).toHaveLength(1)
    const key = reports[0].key
    const got = await signedRequest('GET', `/v1/reports/${key}`)
    expect(got.status).toBe(200)
    expect(JSON.parse(zlib.gunzipSync(Buffer.from(await got.arrayBuffer())).toString()).note).toBe('one')
    expect((await signedRequest('DELETE', `/v1/reports/${key}`)).status).toBe(204)
    expect(env.REPORTS.entries.size).toBe(0)
    expect((await signedRequest('GET', `/v1/reports/${key}`)).status).toBe(404)
  })

  it('refuses unsigned, tampered, stale and foreign-key requests', async () => {
    expect((await worker.fetch(new Request(`${BASE}/v1/reports`), env, ctx())).status).toBe(401)
    expect((await signedRequest('GET', '/v1/reports', { tamper: true })).status).toBe(401)
    expect((await signedRequest('GET', '/v1/reports', { time: Math.floor(Date.now() / 1000) - 600 })).status).toBe(401)
    const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    expect((await signedRequest('GET', '/v1/reports', { signWith: other.privateKey })).status).toBe(401)
  })

  it('a signature is bound to its method and path', async () => {
    await post(report())
    const [key] = env.REPORTS.entries.keys()
    const time = Math.floor(Date.now() / 1000)
    const sig = Buffer.from(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, new TextEncoder().encode(`GET\n/v1/reports/${key}\n${time}`)))
    const res = await worker.fetch(new Request(`${BASE}/v1/reports/${key}`, {
      method: 'DELETE',
      headers: { 'X-Puller-Time': String(time), 'X-Puller-Signature': sig.toString('base64') },
    }), env, ctx())
    expect(res.status).toBe(401)
    expect(env.REPORTS.entries.size).toBe(1)
  })

  it('without a configured public key nothing can be read', async () => {
    delete env.PULLER_PUBLIC_KEY
    expect((await signedRequest('GET', '/v1/reports')).status).toBe(503)
  })

  it('unknown paths and malformed keys are not found', async () => {
    expect((await worker.fetch(new Request(`${BASE}/`), env, ctx())).status).toBe(404)
    expect((await signedRequest('GET', '/v1/reports/..%2Fsecret')).status).toBe(404)
  })
})
