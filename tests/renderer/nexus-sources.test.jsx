// @vitest-environment happy-dom
// Rollback lookups: a Nexus mod page can host several variants (one modId,
// different files). Each card must get the newest snapshot that holds ITS
// mod, not just the newest snapshot of the modId.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useNexusSources, snapshotHoldsMod } from '../../src/renderer/src/hooks/useNexusSources.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('snapshotHoldsMod', () => {
  const snap = { mods: [{ name: 'Cool', modType: 'PAK' }, { name: 'CoolLua', modType: 'UE4SS' }] }
  it('matches PAK forms: _P, prefixed, disabled, IoStore', () => {
    for (const fn of ['Cool_P.pak', 'cool.pak', 'z1_Cool_P.pak', 'Cool_P.pak.disabled', 'Cool_P.utoc']) {
      expect(snapshotHoldsMod(snap, fn, 'PAK')).toBe(true)
    }
    expect(snapshotHoldsMod(snap, 'Other_P.pak', 'PAK')).toBe(false)
  })
  it('matches UE4SS folders by name only, and nothing for snapshots without mods', () => {
    expect(snapshotHoldsMod(snap, 'CoolLua', 'UE4SS')).toBe(true)
    expect(snapshotHoldsMod(snap, 'Cool', 'UE4SS')).toBe(false)
    expect(snapshotHoldsMod({}, 'Cool_P.pak', 'PAK')).toBe(false)
  })
})

describe('useNexusSources rollbackMap', () => {
  let root, el
  afterEach(() => { act(() => root.unmount()); el.remove(); delete window.api })

  it('gives each variant card its own snapshot', async () => {
    window.api = {
      nexus: {
        resolveProfileSources: async () => [
          { filename: 'VarA_P.pak', modId: 5, fileId: 1 },
          { filename: 'VarB_P.pak', modId: 5, fileId: 2 },
        ],
        // newest first: B's snapshot is newer than A's
        listModVersions: async () => ({
          5: [
            { dir: '/r/5/200', fileId: 2, version: '2', savedAt: 200, mods: [{ name: 'VarB', modType: 'PAK' }] },
            { dir: '/r/5/100', fileId: 1, version: '1', savedAt: 100, mods: [{ name: 'VarA', modType: 'PAK' }] },
          ],
        }),
      },
    }
    let result
    // Stable reference, as App's modules state is.
    const modules = [{ filename: 'VarA_P.pak', type: 'PAK' }, { filename: 'VarB_P.pak', type: 'PAK' }]
    function Probe() {
      result = useNexusSources({ modules })
      return null
    }
    el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
    await act(async () => { root.render(<Probe />) })
    await act(async () => {})
    expect(result.rollbackMap.get('VarA_P.pak')?.dir).toBe('/r/5/100')
    expect(result.rollbackMap.get('VarB_P.pak')?.dir).toBe('/r/5/200')
  })
})
