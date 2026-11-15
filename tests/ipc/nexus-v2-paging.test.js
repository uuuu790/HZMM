import { describe, it, expect, beforeEach, vi } from 'vitest'

// Nexus caps each `mods` request at 80 nodes (probed 2026-11-10) — the client
// must walk `offset` pages. The network layer is replaced by a fake catalogue.
const net = vi.hoisted(() => ({ calls: [], serve: null }))
vi.mock('../../src/main/services/net-client', () => ({
  netRequest: async (_url, opts) => {
    const body = JSON.parse(opts.body)
    net.calls.push(body)
    return { statusCode: 200, headers: {}, bodyText: JSON.stringify(net.serve(body.variables)) }
  },
}))

import { v2ListMods, v2SearchMods, V2_PAGE_SIZE } from '../../src/main/ipc/nexus-v2-client'

const catalogue = (n) => Array.from({ length: n }, (_, i) => ({ modId: i + 1, name: `Mod ${i + 1}` }))

// A server that ignores any `count` above its cap, like the real one.
const capped = (all, { cap = 80, totalCount = all.length } = {}) => ({ offset = 0, count }) => ({
  data: { mods: { totalCount, nodes: all.slice(offset, offset + Math.min(cap, count)) } },
})

beforeEach(() => {
  net.calls = []
})

describe('V2 mod list paging', () => {
  it('walks every page past the 80-node cap', async () => {
    net.serve = capped(catalogue(119))
    const page = await v2ListMods({ sort: 'trending' })
    expect(V2_PAGE_SIZE).toBe(80)
    expect(page.totalCount).toBe(119)
    expect(page.nodes.map(m => m.modId)).toEqual(catalogue(119).map(m => m.modId))
    expect(net.calls.map(c => c.variables.offset)).toEqual([0, 80])
    expect(net.calls[0].variables.sort).toEqual([{ endorsements: { direction: 'DESC' } }])
  })

  it('makes a single request when everything fits on one page', async () => {
    net.serve = capped(catalogue(12))
    const page = await v2ListMods({ sort: 'latest_added' })
    expect(page.nodes).toHaveLength(12)
    expect(net.calls).toHaveLength(1)
  })

  it('stops on an empty page even when totalCount promises more', async () => {
    net.serve = capped(catalogue(100), { totalCount: 500 })
    const page = await v2ListMods({})
    expect(page.nodes).toHaveLength(100)
    expect(net.calls.map(c => c.variables.offset)).toEqual([0, 80, 100])
  })

  it('drops a node repeated across a page boundary (ordering shifted mid-walk)', async () => {
    const all = catalogue(90)
    net.serve = ({ offset = 0 }) => ({
      data: { mods: { totalCount: 90, nodes: offset === 0 ? all.slice(0, 80) : all.slice(79, 90) } },
    })
    const page = await v2ListMods({})
    expect(page.nodes.map(m => m.modId)).toEqual(all.map(m => m.modId))
  })
})

describe('V2 search paging', () => {
  it('pages search results the same way and keeps the keyword filter', async () => {
    net.serve = capped(catalogue(85))
    const page = await v2SearchMods({ keyword: 'camera' })
    expect(page.nodes).toHaveLength(85)
    expect(net.calls).toHaveLength(2)
    for (const call of net.calls) {
      expect(call.variables.filter.nameStemmed).toEqual({ value: 'camera' })
      expect(call.variables.sort).toEqual([{ relevance: { direction: 'DESC' } }])
    }
  })
})
