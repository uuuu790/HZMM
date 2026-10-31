// @vitest-environment happy-dom
// Regression tests for the profile/backup hook fixes: profiles re-read after a
// main-side pak rename (and every write starts from the stored copy), the
// synchronous apply guard, fileId-less Nexus sources, import sanitizing, the
// local createdAt date, the backups list refresh after the pre-apply
// auto-backup, and backup-delete failures.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useProfileHandlers } from '../../src/renderer/src/hooks/useProfileHandlers.js'
import { useBackupHandlers } from '../../src/renderer/src/hooks/useBackupHandlers.js'
import ProfilesTab from '../../src/renderer/src/components/tabs/ProfilesTab.jsx'
import { UI_TEXT } from '../../src/renderer/src/constants/i18n/index.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const t = UI_TEXT.en
const clone = (v) => JSON.parse(JSON.stringify(v))

const mounted = []
function mountHook(useHook, props) {
  const result = { current: null }
  function Probe(p) {
    result.current = useHook(p)
    return null
  }
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => root.render(<Probe {...props} />))
  mounted.push({ root, el })
  return { result, rerender: (p) => act(() => root.render(<Probe {...p} />)) }
}

const ORIG_TZ = process.env.TZ
afterEach(() => {
  for (const { root, el } of mounted.splice(0)) {
    act(() => root.unmount())
    el.remove()
  }
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (ORIG_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIG_TZ
  delete window.api
})

// Fake main process. mods: { id, filename, enabled, type }; PAK ids are the
// enabled filename, as in the real scan.
function fakeApi(store, mods = []) {
  const updatedListeners = new Set()
  const api = {
    settings: {
      get: vi.fn(async (k, d) => (k in store ? clone(store[k]) : d)),
      set: vi.fn(async (k, v) => { store[k] = clone(v) }),
    },
    mods: {
      scan: vi.fn(async () => mods.map(m => ({ ...m }))),
      toggle: vi.fn(async (fn) => {
        const m = mods.find(x => x.filename === fn)
        if (!m) throw new Error(`File not found: ${fn}`)
        m.enabled = !m.enabled
        if (m.type === 'PAK') m.filename = m.enabled ? m.id : `${m.id}.disabled`
        return { enabled: m.enabled }
      }),
      snapshotConfigs: vi.fn(async () => ({})),
      restoreConfigs: vi.fn(async () => true),
      onUpdated: vi.fn((cb) => {
        updatedListeners.add(cb)
        return () => updatedListeners.delete(cb)
      }),
    },
    saves: {
      autoBackup: vi.fn(async () => ({ skipped: true, reason: 'no-saves' })),
      listBackups: vi.fn(async () => []),
      deleteBackup: vi.fn(async () => true),
    },
    nexus: {
      validate: vi.fn(async () => ({ ok: false })),
      resolveProfileSources: vi.fn(async () => []),
      // Mirrors nexus:install-file's argument validation.
      installFile: vi.fn(async (modId, fileId) => {
        if (!(Number.isInteger(fileId) && fileId > 0)) throw new Error('Invalid file id')
        return { ok: true, fellBackToLatest: false, mods: [] }
      }),
      installMod: vi.fn(async () => []),
    },
  }
  return { api, emitModsUpdated: () => { for (const cb of updatedListeners) cb() } }
}

function mountProfiles(api, modules, extra = {}) {
  window.api = api
  const addToast = vi.fn()
  const props = {
    addToast,
    showConfirm: vi.fn((_title, _desc, onConfirm) => { props.lastConfirm = onConfirm }),
    closeConfirm: vi.fn(),
    t,
    modules,
    persistSetting: (k, v) => { window.api.settings.set(k, v) },
    refreshMods: vi.fn(async () => {}),
    ...extra,
  }
  const h = mountHook(useProfileHandlers, props)
  return { ...h, props, addToast }
}

// Mounted the way App does it: initProfiles has loaded the stored list.
async function mountProfilesLoaded(api, modules, extra) {
  const h = mountProfiles(api, modules, extra)
  await act(async () => { await h.result.current.initProfiles() })
  return h
}

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

describe('profiles migrated by main on a pak rename (gids 18/45/82/131)', () => {
  function setup() {
    const store = {
      profiles: [
        { id: 'p1', name: 'Coop', enabledModFilenames: ['foo.pak'], nexusSources: [], configSnapshot: null, createdAt: '2026-01-01' },
        { id: 'p2', name: 'Solo', enabledModFilenames: [], nexusSources: [], configSnapshot: null, createdAt: '2026-01-02' },
      ],
    }
    const mods = [{ id: 'foo.pak', filename: 'foo.pak', enabled: true, type: 'PAK' }]
    const { api, emitModsUpdated } = fakeApi(store, mods)
    const h = mountProfiles(api, mods.map(m => ({ ...m })))
    // What renamePakEverywhere does in main for "Make it win".
    const renameInMain = () => {
      mods[0].id = 'z1_foo.pak'
      mods[0].filename = 'z1_foo.pak'
      store.profiles[0].enabledModFilenames = ['z1_foo.pak']
      h.rerender({ ...h.props, modules: mods.map(m => ({ ...m })) })
    }
    return { store, mods, api, emitModsUpdated, h, renameInMain }
  }

  it('re-reads profiles when main sends mods:updated', async () => {
    const { h, emitModsUpdated, renameInMain } = setup()
    await act(async () => { await h.result.current.initProfiles() })
    expect(h.result.current.profiles[0].enabledModFilenames).toEqual(['foo.pak'])
    renameInMain()
    emitModsUpdated()
    await flush()
    expect(h.result.current.profiles[0].enabledModFilenames).toEqual(['z1_foo.pak'])
  })

  it('creating a profile keeps the migrated names in the store', async () => {
    const { store, h, renameInMain } = setup()
    await act(async () => { await h.result.current.initProfiles() })
    renameInMain()
    act(() => h.result.current.setNewProfileName('New'))
    await act(async () => { await h.result.current.handleCreateProfile() })
    expect(store.profiles.map(p => p.name)).toEqual(['Coop', 'Solo', 'New'])
    expect(store.profiles[0].enabledModFilenames).toEqual(['z1_foo.pak'])
  })

  it('deleting another profile keeps the migrated names in the store', async () => {
    const { store, h, renameInMain } = setup()
    await act(async () => { await h.result.current.initProfiles() })
    renameInMain()
    act(() => h.result.current.handleDeleteProfile('p2'))
    await act(async () => { await h.props.lastConfirm() })
    expect(store.profiles.map(p => p.id)).toEqual(['p1'])
    expect(store.profiles[0].enabledModFilenames).toEqual(['z1_foo.pak'])
  })

  it('applying uses the stored profile: no missing-mods modal, renamed pak left enabled', async () => {
    const { api, h, mods, renameInMain } = setup()
    await act(async () => { await h.result.current.initProfiles() })
    renameInMain()
    await act(async () => { await h.result.current.handleApplyProfile('p1') })
    expect(h.result.current.importModal).toBeNull()
    expect(api.mods.toggle).not.toHaveBeenCalled()
    expect(mods[0].enabled).toBe(true)
    expect(h.addToast).toHaveBeenCalledWith(t.toastProfileApplied, 'success')
  })

  it('stops listening on unmount', async () => {
    const { api } = setup()
    const unsub = api.mods.onUpdated.mock.results[0].value
    expect(typeof unsub).toBe('function')
    const root = mounted[0].root
    act(() => root.unmount())
    mounted.splice(0)
    expect(unsub()).toBe(false) // already removed by the effect cleanup
  })
})

describe('apply in-flight guard (gids 83/89)', () => {
  it('a second Apply while the Nexus validate call is pending is ignored', async () => {
    const store = { profiles: [{ id: 'p1', name: 'P', enabledModFilenames: [] }] }
    // UE4SS mod the profile wants disabled; a toggle flips it on disk.
    const mods = [{ id: 'ue4ss:MyLuaMod', filename: 'MyLuaMod', enabled: true, type: 'UE4SS' }]
    const { api } = fakeApi(store, mods)
    let releaseValidate
    const h = await mountProfilesLoaded(api, mods.map(m => ({ ...m })))
    api.nexus.validate.mockImplementation(() => new Promise(r => { releaseValidate = () => r({ ok: true }) }))

    let first, second
    act(() => {
      first = h.result.current.handleApplyProfile('p1')
      second = h.result.current.handleApplyProfile('p1')
    })
    await flush()
    expect(h.result.current.applyingProfileId).toBe('p1')
    expect(api.nexus.validate).toHaveBeenCalledTimes(1)
    await act(async () => { releaseValidate(); await first; await second })
    expect(api.mods.toggle).toHaveBeenCalledTimes(1)
    expect(mods[0].enabled).toBe(false)
    expect(h.result.current.applyingProfileId).toBeNull()
  })

  it('"Apply anyway" holds the guard while it runs', async () => {
    const store = {
      profiles: [
        { id: 'p1', name: 'P', enabledModFilenames: ['gone.pak'] },
        { id: 'p2', name: 'Q', enabledModFilenames: [] },
      ],
    }
    const mods = [{ id: 'X', filename: 'X', enabled: true, type: 'UE4SS' }]
    const { api } = fakeApi(store, mods)
    const h = await mountProfilesLoaded(api, mods.map(m => ({ ...m })))
    await act(async () => { await h.result.current.handleApplyProfile('p1') })
    expect(h.result.current.importModal?.missing).toEqual(['gone.pak'])

    let releaseBackup
    api.saves.autoBackup.mockImplementation(() => new Promise(r => { releaseBackup = () => r({ skipped: true }) }))
    let anyway
    act(() => { anyway = h.result.current.importApplyAnyway() })
    await flush()
    expect(h.result.current.importModal).toBeNull()
    expect(h.result.current.applyingProfileId).toBe('p1')
    // Another profile's Apply during the run must not start a second apply.
    await act(async () => { await h.result.current.handleApplyProfile('p2') })
    await act(async () => { releaseBackup(); await anyway })
    expect(api.mods.toggle).toHaveBeenCalledTimes(1)
    expect(mods[0].enabled).toBe(false)
    expect(h.result.current.applyingProfileId).toBeNull()
  })
})

describe('auto-download of Nexus sources without a fileId (gids 87/130)', () => {
  async function setup(store = {
    profiles: [{
      id: 'p1', name: 'P', enabledModFilenames: ['Quick.pak', 'Kept.pak'],
      nexusSources: [{ filename: 'Quick.pak', modId: 42, fileId: null, version: null, displayName: 'Quick' }],
    }],
  }) {
    const mods = [{ id: 'Kept.pak', filename: 'Kept.pak', enabled: true, type: 'PAK' }]
    const { api } = fakeApi(store, mods)
    api.nexus.validate.mockResolvedValue({ ok: true })
    const h = await mountProfilesLoaded(api, mods.map(m => ({ ...m })))
    return { api, h }
  }
  it('installs the latest file via installMod instead of the rejecting installFile', async () => {
    const { api, h } = await setup()
    await act(async () => { await h.result.current.handleApplyProfile('p1') })
    expect(h.result.current.importModal.auto.map(s => s.modId)).toEqual([42])
    await act(async () => { await h.result.current.importDownloadAndApply() })
    expect(api.nexus.installMod).toHaveBeenCalledWith(42)
    expect(api.nexus.installFile).not.toHaveBeenCalled()
    // Latest, not a pinned version: surfaced like any other drift.
    expect(h.addToast).toHaveBeenCalledWith(`${t.toastProfileVersionDrift}Quick`, 'warning')
  })

  it('a failed download is reported instead of a plain success', async () => {
    const { api, h } = await setup()
    api.nexus.installMod.mockRejectedValue(new Error('NEXUS_API_KEY_REQUIRED'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => { await h.result.current.handleApplyProfile('p1') })
    await act(async () => { await h.result.current.importDownloadAndApply() })
    expect(h.addToast).not.toHaveBeenCalledWith(t.toastProfileApplied, 'success')
    expect(h.addToast).toHaveBeenCalledWith(`${t.toastProfileApplied} (1 ✕)`, 'warning')
    expect(h.addToast).toHaveBeenCalledWith(`${t.nexusInstallFailedToast}: Quick`, 'warning')
  })

  it('a pinned fileId still goes through installFile', async () => {
    const { api, h } = await setup({
      profiles: [{
        id: 'p1', name: 'P', enabledModFilenames: ['Pin.pak', 'Kept.pak'],
        nexusSources: [{ filename: 'Pin.pak', modId: 7, fileId: 70, version: '1.0', displayName: 'Pin' }],
      }],
    })
    await act(async () => { await h.result.current.handleApplyProfile('p1') })
    await act(async () => { await h.result.current.importDownloadAndApply() })
    expect(api.nexus.installFile).toHaveBeenCalledWith(7, 70, '1.0', true)
    expect(api.nexus.installMod).not.toHaveBeenCalled()
  })
})

// Runs handleImportProfile with `json` as the picked file's contents.
function importJson(h, json) {
  let input
  const realCreate = document.createElement.bind(document)
  const spy = vi.spyOn(document, 'createElement').mockImplementation((tag, opts) => {
    const el = realCreate(tag, opts)
    if (tag === 'input') {
      input = el
      el.click = () => {}
    }
    return el
  })
  act(() => h.result.current.handleImportProfile())
  spy.mockRestore()
  const file = { text: async () => JSON.stringify(json) }
  return act(async () => { await input.onchange({ target: { files: [file] } }) })
}

describe('profile import validation (gid 88)', () => {
  it('drops wrong-typed entries so the Profiles tab still renders', async () => {
    const store = { profiles: [] }
    const { api } = fakeApi(store)
    const h = mountProfiles(api, [])
    await importJson(h, { name: 'Shared', enabledModFilenames: ['a.pak', 42, null], nexusSources: {}, configSnapshot: 'x' })
    expect(h.addToast).toHaveBeenCalledWith(t.toastProfileImported, 'success')
    expect(store.profiles).toHaveLength(1)
    expect(store.profiles[0]).toMatchObject({ name: 'Shared', enabledModFilenames: ['a.pak'], nexusSources: [], configSnapshot: null })

    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    mounted.push({ root, el })
    const r = h.result.current
    act(() => root.render(<ProfilesTab t={t} modules={[]} {...r} />))
    expect(el.textContent).toContain('Shared')
  })

  it('rejects a non-string name', async () => {
    const store = { profiles: [] }
    const { api } = fakeApi(store)
    const h = mountProfiles(api, [])
    await importJson(h, { name: { x: 1 }, enabledModFilenames: [] })
    expect(h.addToast).toHaveBeenCalledWith(t.toastProfileImportError, 'error')
    expect(store.profiles).toEqual([])
  })

  it('heals an already-persisted bad profile on load', async () => {
    const store = { profiles: [{ id: 'p1', name: 'Old', enabledModFilenames: ['a.pak', 42], nexusSources: 'bad' }] }
    const { api } = fakeApi(store)
    const h = mountProfiles(api, [])
    await act(async () => { await h.result.current.initProfiles() })
    expect(h.result.current.profiles[0]).toMatchObject({ enabledModFilenames: ['a.pak'], nexusSources: [] })
  })
})

describe('createdAt uses the local date (gid 97)', () => {
  it('a profile created at 01:00 in Taipei is dated that day', async () => {
    process.env.TZ = 'Asia/Taipei'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-30T17:00:00Z')) // 2026-10-31 01:00 +08:00
    const store = { profiles: [] }
    const { api } = fakeApi(store)
    const h = mountProfiles(api, [])
    act(() => h.result.current.setNewProfileName('Night'))
    await act(async () => { await h.result.current.handleCreateProfile() })
    expect(store.profiles[0].createdAt).toBe('2026-10-31')
  })
})

describe('backups list after the pre-apply auto-backup (gid 95)', () => {
  it('re-reads the list once the auto-backup lands', async () => {
    const store = { profiles: [{ id: 'p1', name: 'P', enabledModFilenames: [] }] }
    const { api } = fakeApi(store)
    let disk = [{ name: 'save_backup_auto_01' }]
    api.saves.listBackups.mockImplementation(async () => disk)
    api.saves.autoBackup.mockImplementation(async () => {
      disk = [{ name: 'save_backup_auto_02' }]
      return { path: 'x', timestamp: 'y', worlds: 1, totalSize: 1 }
    })
    window.api = api
    const backups = mountHook(useBackupHandlers, { addToast: vi.fn(), showConfirm: vi.fn(), t })
    await act(async () => { await backups.result.current.initBackups() })
    expect(backups.result.current.backups.map(b => b.name)).toEqual(['save_backup_auto_01'])

    const h = await mountProfilesLoaded(api, [])
    await act(async () => { await h.result.current.handleApplyProfile('p1') })
    expect(api.saves.autoBackup).toHaveBeenCalledTimes(1)
    await flush()
    expect(backups.result.current.backups.map(b => b.name)).toEqual(['save_backup_auto_02'])
  })
})

describe('deleting a backup that fails (gid 112)', () => {
  function setup() {
    const { api } = fakeApi({})
    window.api = api
    let confirm
    const addToast = vi.fn()
    const h = mountHook(useBackupHandlers, { addToast, showConfirm: (_a, _b, cb) => { confirm = cb }, t })
    return { api, h, addToast, run: async (p) => { act(() => h.result.current.handleDeleteBackup(p)); await act(async () => { await confirm() }) } }
  }

  it('shows an error toast and re-reads the list when main throws', async () => {
    const { api, addToast, run } = setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api.saves.deleteBackup.mockRejectedValue(new Error("Error invoking remote method 'saves:delete-backup': Error: EBUSY: resource busy or locked"))
    await run('C:\\b\\save_backup_1')
    expect(addToast).toHaveBeenCalledWith(`${t.toastBackupDeleteFailed}: EBUSY: resource busy or locked`, 'error')
    expect(addToast).not.toHaveBeenCalledWith(t.toastBackupDeleted, 'success')
    expect(api.saves.listBackups).toHaveBeenCalled()
  })

  it('treats a false result as a failure', async () => {
    const { api, addToast, run } = setup()
    api.saves.deleteBackup.mockResolvedValue(false)
    await run('C:\\elsewhere')
    expect(addToast).toHaveBeenCalledWith(t.toastBackupDeleteFailed, 'error')
  })

  it('still reports success when the delete works', async () => {
    const { addToast, run } = setup()
    await run('C:\\b\\save_backup_1')
    expect(addToast).toHaveBeenCalledWith(t.toastBackupDeleted, 'success')
  })
})

// Review follow-ups ---------------------------------------------------------

// IPC as Electron runs it: main handles each invoke in the order it was sent,
// and the replies arrive later, also in order (drain delivers them).
function queuedApi(store) {
  const pending = []
  let listener = null
  const invoke = (fn) => new Promise(res => { const v = fn(); pending.push(() => res(v)) })
  const api = {
    settings: {
      get: vi.fn((k, d) => invoke(() => (k in store ? clone(store[k]) : d))),
      set: vi.fn((k, v) => invoke(() => { store[k] = clone(v) })),
    },
    mods: {
      snapshotConfigs: async () => ({}),
      onUpdated: (cb) => { listener = cb; return () => { listener = null } },
    },
    nexus: { resolveProfileSources: async () => [] },
  }
  const tick = () => new Promise(r => setTimeout(r, 0))
  const drain = async () => {
    while (pending.length) { pending.shift()(); await tick() }
    await tick()
  }
  return { api, emitModsUpdated: () => listener?.(), drain, tick, pendingCount: () => pending.length }
}

describe('a mods:updated reload racing a local write (review follow-up)', () => {
  async function setup(profiles) {
    const store = { profiles }
    const q = queuedApi(store)
    const h = mountProfiles(q.api, [])
    await act(async () => { const p = h.result.current.initProfiles(); await q.drain(); await p; await q.drain() })
    return { store, q, h }
  }
  // The local write's settings.get is in flight; mods:updated (e.g. a
  // background Nexus install finishing) sends the reload's get right after.
  async function raceWith(q, write) {
    await act(async () => {
      const done = write()
      await q.tick()
      expect(q.pendingCount()).toBe(1)
      q.emitModsUpdated()
      await q.drain()
      await done
      await q.drain()
    })
  }

  it('does not hide a just-created profile', async () => {
    const { store, q, h } = await setup([{ id: 'p1', name: 'A', enabledModFilenames: [] }])
    expect(h.result.current.profiles.map(p => p.name)).toEqual(['A'])
    act(() => h.result.current.setNewProfileName('B'))
    await raceWith(q, () => h.result.current.handleCreateProfile())
    expect(store.profiles.map(p => p.name)).toEqual(['A', 'B'])
    expect(h.result.current.profiles.map(p => p.name)).toEqual(['A', 'B'])
  })

  it('does not bring back a just-deleted profile', async () => {
    const { store, q, h } = await setup([
      { id: 'p1', name: 'A', enabledModFilenames: [] },
      { id: 'p2', name: 'B', enabledModFilenames: [] },
    ])
    act(() => h.result.current.handleDeleteProfile('p2'))
    await raceWith(q, () => h.props.lastConfirm())
    expect(store.profiles.map(p => p.id)).toEqual(['p1'])
    expect(h.result.current.profiles.map(p => p.id)).toEqual(['p1'])
  })
})

describe('profiles migrated by the update flow, which sends no mods:updated (review follow-up)', () => {
  it('re-reads the stored profiles when the mod list is refreshed', async () => {
    const store = { profiles: [{ id: 'p1', name: 'Coop', enabledModFilenames: ['foo.pak'] }] }
    const mods = [{ id: 'foo.pak', filename: 'foo.pak', enabled: true, type: 'PAK' }]
    const { api } = fakeApi(store, mods)
    const h = await mountProfilesLoaded(api, mods.map(m => ({ ...m })))
    expect(h.result.current.profiles[0].enabledModFilenames).toEqual(['foo.pak'])
    // restoreModState re-applies the dropped prefix via renamePakEverywhere;
    // the renderer only learns of it through its refreshMods afterwards.
    store.profiles[0].enabledModFilenames = ['z1_foo.pak']
    h.rerender({ ...h.props, modules: [{ id: 'z1_foo.pak', filename: 'z1_foo.pak', enabled: true, type: 'PAK' }] })
    await flush()
    expect(h.result.current.profiles[0].enabledModFilenames).toEqual(['z1_foo.pak'])
  })
})

describe('stored profiles with a blank or non-text name (review follow-up)', () => {
  const stored = () => [
    { id: 'p1', name: '  ', enabledModFilenames: ['a.pak'] },
    { id: 'p2', name: true, enabledModFilenames: [] },
    { id: 'p3', name: 'Ok', enabledModFilenames: [] },
  ]

  it('are shown under a placeholder name instead of vanishing', async () => {
    const store = { profiles: stored() }
    const { api } = fakeApi(store)
    const h = await mountProfilesLoaded(api, [])
    expect(h.result.current.profiles.map(p => [p.id, p.name])).toEqual([
      ['p1', t.profileUnnamed], ['p2', t.profileUnnamed], ['p3', 'Ok'],
    ])
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    mounted.push({ root, el })
    act(() => root.render(<ProfilesTab t={t} modules={[]} {...h.result.current} />))
    expect(el.textContent).toContain(t.profileUnnamed)
  })

  it('survive the next write instead of being deleted from the store', async () => {
    const store = { profiles: stored() }
    const { api } = fakeApi(store)
    const h = await mountProfilesLoaded(api, [])
    act(() => h.result.current.setNewProfileName('New'))
    await act(async () => { await h.result.current.handleCreateProfile() })
    expect(store.profiles.map(p => p.id).slice(0, 3)).toEqual(['p1', 'p2', 'p3'])
    expect(store.profiles).toHaveLength(4)
    expect(store.profiles[0]).toMatchObject({ name: t.profileUnnamed, enabledModFilenames: ['a.pak'] })
  })

  it('import still rejects a file with a blank name', async () => {
    const store = { profiles: [] }
    const { api } = fakeApi(store)
    const h = mountProfiles(api, [])
    await importJson(h, { name: '   ', enabledModFilenames: [] })
    expect(h.addToast).toHaveBeenCalledWith(t.toastProfileImportError, 'error')
    expect(store.profiles).toEqual([])
  })
})
