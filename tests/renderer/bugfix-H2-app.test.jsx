// @vitest-environment happy-dom
// Regression tests for the app-shell hooks: app self-update error states,
// single uninstall errors, UE4SS/game info after a game path change, one Nexus
// mod update at a time, update badges that survive a toggle/rename, the startup
// update check running once, batch remove of a hybrid pair, stale install
// previews, filename-keyed batch selection after a rename, the Shift+click
// anchor after a re-sort, launch with conflicts / launch errors, and the
// document language.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Package } from 'lucide-react'
import { useUpdateHandlers } from '../../src/renderer/src/hooks/useUpdateHandlers.js'
import { useModHandlers } from '../../src/renderer/src/hooks/useModHandlers.jsx'
import { useAppInit } from '../../src/renderer/src/hooks/useAppInit.js'
import { useUpdateChecker, updateMapKey } from '../../src/renderer/src/hooks/useUpdateChecker.js'
import ModuleList from '../../src/renderer/src/components/common/ModuleList.jsx'
import App from '../../src/renderer/src/App.jsx'
import { UI_TEXT } from '../../src/renderer/src/constants/i18n/index.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const en = UI_TEXT.en
const mounted = []

function mountNode(node) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => root.render(node))
  mounted.push({ root, el })
  return { el, rerender: (next) => act(() => root.render(next)) }
}

function renderHook(useHook, props) {
  const result = { current: null }
  function Harness({ hookProps }) {
    result.current = useHook(hookProps)
    return null
  }
  const { rerender } = mountNode(<Harness hookProps={props} />)
  return { result, rerender: (next) => rerender(<Harness hookProps={next} />) }
}

const flush = () => act(async () => {})

afterEach(() => {
  for (const { root, el } of mounted.splice(0)) {
    act(() => root.unmount())
    el.remove()
  }
  vi.restoreAllMocks()
  delete window.api
})

function toastSpy() {
  const toasts = []
  return { toasts, addToast: vi.fn((msg, type) => toasts.push([msg, type])) }
}

function confirmSpy() {
  const calls = []
  return { calls, showConfirm: vi.fn((title, desc, onConfirm, variant) => calls.push({ title, desc, onConfirm, variant })) }
}

// --- App self-update (gids 46, 86, 134, 91) ---------------------------------

describe('useUpdateHandlers error states', () => {
  const available = { hasUpdate: true, currentVersion: '1.7.0', latestVersion: '1.8.0', downloadUrl: 'https://github.com/x/y.exe', expectedHash: 'abc' }

  it('a failed check (resolved with error) goes back to idle with the error, not "up to date"', async () => {
    window.api = { appUpdate: { check: vi.fn(async () => ({ hasUpdate: false, currentVersion: '1.7.0', error: 'getaddrinfo ENOTFOUND api.github.com' })) } }
    const { result } = renderHook(() => useUpdateHandlers())
    await act(async () => { await result.current.handleCheckUpdate() })
    expect(result.current.updateState).toBe('idle')
    expect(result.current.updateError).toMatch(/ENOTFOUND/)
  })

  it('a successful check without an update still reports latest', async () => {
    window.api = { appUpdate: { check: vi.fn(async () => ({ hasUpdate: false, currentVersion: '1.7.0' })) } }
    const { result } = renderHook(() => useUpdateHandlers())
    await act(async () => { await result.current.handleCheckUpdate() })
    expect(result.current.updateState).toBe('latest')
    expect(result.current.updateError).toBe(null)
  })

  it('a failed download keeps its error message', async () => {
    window.api = { appUpdate: {
      check: vi.fn(async () => available),
      onProgress: vi.fn(() => () => {}),
      download: vi.fn(async () => { throw new Error('Update integrity check failed') }),
    } }
    const { result } = renderHook(() => useUpdateHandlers())
    await act(async () => { await result.current.handleCheckUpdate() })
    await act(async () => { await result.current.handleDownloadUpdate() })
    expect(result.current.updateState).toBe('available')
    expect(result.current.updateError).toMatch(/integrity/)
  })

  async function installFailingWith(message) {
    window.api = { appUpdate: {
      check: vi.fn(async () => available),
      onProgress: vi.fn(() => () => {}),
      download: vi.fn(async () => ({ filePath: 'C:\\cfg\\hzmm-update.exe' })),
      onInstallFailed: vi.fn(() => () => {}),
      install: vi.fn(async () => { throw new Error(message) }),
    } }
    const { result } = renderHook(() => useUpdateHandlers())
    await act(async () => { await result.current.handleCheckUpdate() })
    await act(async () => { await result.current.handleDownloadUpdate() })
    expect(result.current.updateState).toBe('ready')
    await act(async () => { await result.current.handleInstallUpdate() })
    return result.current
  }

  it('an install that finds the downloaded file missing offers Download again', async () => {
    const h = await installFailingWith("Error invoking remote method 'app-update:install': Error: Update file not found. Please download first.")
    expect(h.updateState).toBe('available')
    expect(h.updateError).toMatch(/not found/)
    expect(h.isUpdating).toBe(false)
  })

  it('an install whose file failed re-verification offers Download again', async () => {
    const h = await installFailingWith('Update file failed re-verification. Please download the update again.')
    expect(h.updateState).toBe('available')
  })

  it('any other install failure stays on ready (the file is still there)', async () => {
    const h = await installFailingWith('Cannot write to current executable: EPERM')
    expect(h.updateState).toBe('ready')
    expect(h.updateError).toMatch(/EPERM/)
  })
})

// --- Mod handlers --------------------------------------------------------------

function modProps(extra = {}) {
  const { toasts, addToast } = toastSpy()
  const { calls, showConfirm } = confirmSpy()
  return {
    toasts, confirms: calls,
    props: { addToast, showConfirm, t: en, isGameRunning: false, persistSetting: () => {}, skipInstallPreview: false, ...extra },
  }
}

describe('single uninstall (gids 84, 99, 133)', () => {
  it('a failed remove shows an error toast, rescans and does not reject', async () => {
    const scan = vi.fn(async () => [{ id: 'X_P.pak', filename: 'X_P.pak', type: 'PAK', enabled: true }])
    window.api = { mods: {
      scan,
      remove: vi.fn(async () => { throw new Error("EBUSY: resource busy or locked, unlink 'C:\\Game\\~mods\\X_P.pak'") }),
    } }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { toasts, confirms, props } = modProps({ isGameRunning: true })
    const { result } = renderHook(useModHandlers, props)
    await act(async () => { await result.current.initMods() })
    const scansBefore = scan.mock.calls.length

    act(() => { result.current.handleUninstallLocalMod('X_P.pak') })
    expect(confirms).toHaveLength(1)
    await act(async () => { await expect(confirms[0].onConfirm()).resolves.toBeUndefined() })

    expect(toasts).toHaveLength(1)
    expect(toasts[0][1]).toBe('error')
    expect(toasts[0][0]).toContain(en.toastUninstallFailed)
    expect(toasts[0][0]).toMatch(/EBUSY/)
    expect(scan.mock.calls.length).toBe(scansBefore + 1)
  })

  it('a successful remove still shows the uninstalled toast', async () => {
    window.api = { mods: {
      scan: vi.fn(async () => []),
      remove: vi.fn(async () => {}),
    } }
    const { toasts, confirms, props } = modProps()
    const { result } = renderHook(useModHandlers, props)
    act(() => { result.current.handleUninstallLocalMod('X_P.pak') })
    await act(async () => { await confirms[0].onConfirm() })
    expect(toasts).toEqual([[en.toastUninstalled, 'warning']])
  })
})

describe('uninstall confirm for a hybrid pak row (integration follow-up)', () => {
  it('lists the UE4SS folder and the sibling paks that go with it', async () => {
    const disk = [
      { id: 'ue4ss:MyMod', filename: 'MyMod', type: 'UE4SS', enabled: true, hybrid: true, linkedPaks: ['MyMod_P.pak', 'MyModExtra_P.pak'] },
      { id: 'MyMod_P.pak', filename: 'MyMod_P.pak', type: 'PAK', enabled: true, hybrid: true, linkedUe4ss: 'MyMod' },
      { id: 'MyModExtra_P.pak', filename: 'MyModExtra_P.pak', type: 'PAK', enabled: true, hybrid: true, linkedUe4ss: 'MyMod' },
    ]
    window.api = { mods: { scan: vi.fn(async () => disk.map(m => ({ ...m }))), remove: vi.fn(async () => {}) } }
    const { confirms, props } = modProps()
    const { result } = renderHook(useModHandlers, props)
    await act(async () => { await result.current.initMods() })
    act(() => { result.current.handleUninstallLocalMod('MyMod_P.pak') })
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    act(() => root.render(confirms[0].desc))
    expect(el.textContent).toContain('MyMod')
    expect(el.textContent).toContain('MyModExtra_P.pak')
    expect(el.textContent).not.toContain('MyMod_P.pak')
    act(() => root.unmount())
    el.remove()
  })
})

describe('batch remove of a hybrid pair (gids 92, 137)', () => {
  it('removing the UE4SS half first does not report the cascaded pak as a failure', async () => {
    let disk = [
      { id: 'ue4ss:MyMod', filename: 'MyMod', type: 'UE4SS', enabled: true, hybrid: true, linkedPaks: ['MyMod_P.pak'] },
      { id: 'MyMod_P.pak', filename: 'MyMod_P.pak', type: 'PAK', enabled: true, hybrid: true, linkedUe4ss: 'MyMod' },
    ]
    const remove = vi.fn(async (fn) => {
      // mods:remove cascades: the UE4SS half takes its linked pak with it.
      if (fn === 'MyMod') { disk = disk.filter(m => m.filename !== 'MyMod' && m.filename !== 'MyMod_P.pak'); return }
      if (!disk.some(m => m.filename === fn)) throw new Error(`PAK file not found: ${fn}`)
      disk = disk.filter(m => m.filename !== fn)
    })
    window.api = { mods: { scan: vi.fn(async () => disk.map(m => ({ ...m }))), remove } }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { toasts, confirms, props } = modProps()
    const { result } = renderHook(useModHandlers, props)
    await act(async () => { await result.current.initMods() })
    act(() => { result.current.handleToggleSelect('MyMod') })
    act(() => { result.current.handleToggleSelect('MyMod_P.pak') })

    act(() => { result.current.handleBatchRemove() })
    await act(async () => { await confirms[0].onConfirm() })

    expect(disk).toEqual([])
    expect(remove).toHaveBeenCalledTimes(1)
    expect(toasts).toEqual([[en.toastUninstalled, 'warning']])
  })
})

describe('batch selection follows a renamed pak (gid 98)', () => {
  function pakDisk() {
    const disk = [
      { id: 'Foo_P.pak', filename: 'Foo_P.pak', type: 'PAK', enabled: true },
      { id: 'Bar_P.pak', filename: 'Bar_P.pak', type: 'PAK', enabled: true },
    ]
    const toggle = vi.fn(async (fn) => {
      const m = disk.find(x => x.filename === fn)
      if (!m) throw new Error(`PAK file not found: ${fn}`)
      m.enabled = !m.enabled
      m.filename = m.enabled ? m.id : `${m.id}.disabled`
      return { enabled: m.enabled }
    })
    const remove = vi.fn(async (fn) => {
      const i = disk.findIndex(x => x.filename === fn)
      if (i < 0) throw new Error(`PAK file not found: ${fn}`)
      disk.splice(i, 1)
    })
    return { disk, toggle, remove, scan: vi.fn(async () => disk.map(m => ({ ...m }))) }
  }

  it('a row toggle remaps the selected filename, so batch Enable acts on the current name', async () => {
    const fake = pakDisk()
    window.api = { mods: { scan: fake.scan, toggle: fake.toggle, remove: fake.remove } }
    const { toasts, props } = modProps()
    const { result } = renderHook(useModHandlers, props)
    await act(async () => { await result.current.initMods() })

    act(() => { result.current.handleToggleSelect('Foo_P.pak') })
    await act(async () => { await result.current.handleToggleEnable('Foo_P.pak') })
    expect([...result.current.selectedMods]).toEqual(['Foo_P.pak.disabled'])

    await act(async () => { await result.current.handleBatchToggle(true) })
    expect(fake.toggle).toHaveBeenLastCalledWith('Foo_P.pak.disabled')
    expect(fake.disk.find(m => m.id === 'Foo_P.pak').enabled).toBe(true)
    expect(toasts.at(-1)).toEqual([en.toastEnabled, 'success'])
  })

  it('a mod removed with its own trash button leaves the selection', async () => {
    const fake = pakDisk()
    window.api = { mods: { scan: fake.scan, toggle: fake.toggle, remove: fake.remove } }
    const { confirms, props } = modProps()
    const { result } = renderHook(useModHandlers, props)
    await act(async () => { await result.current.initMods() })

    act(() => { result.current.handleToggleSelect('Bar_P.pak') })
    act(() => { result.current.handleToggleSelect('Foo_P.pak') })
    act(() => { result.current.handleUninstallLocalMod('Bar_P.pak') })
    await act(async () => { await confirms[0].onConfirm() })
    expect([...result.current.selectedMods]).toEqual(['Foo_P.pak'])
  })
})

describe('install preview race (gid 93)', () => {
  function deferredPreviews() {
    const pending = {}
    const preview = vi.fn((paths) => new Promise(resolve => { pending[paths[0]] = resolve }))
    return { pending, preview }
  }

  it('an earlier, slower preview does not overwrite the pending archive\'s preview', async () => {
    const { pending, preview } = deferredPreviews()
    window.api = { mods: { scan: vi.fn(async () => []), preview } }
    const { props } = modProps()
    const { result } = renderHook(useModHandlers, props)

    act(() => { result.current.handleInstallWithPreview(['C:\\dl\\big.7z']) })
    act(() => { result.current.handleInstallWithPreview(['C:\\dl\\small.zip']) })
    await act(async () => { pending['C:\\dl\\small.zip']([{ archive: 'small.zip' }]) })
    expect(result.current.previewLoading).toBe(false)
    await act(async () => { pending['C:\\dl\\big.7z']([{ archive: 'big.7z' }]) })

    expect(result.current.pendingInstallPaths).toEqual(['C:\\dl\\small.zip'])
    expect(result.current.previewData).toEqual([{ archive: 'small.zip' }])
  })

  it('cancelPreview closes the dialog and ignores the late result', async () => {
    const { pending, preview } = deferredPreviews()
    window.api = { mods: { scan: vi.fn(async () => []), preview } }
    const { props } = modProps()
    const { result } = renderHook(useModHandlers, props)

    act(() => { result.current.handleInstallWithPreview(['C:\\dl\\big.7z']) })
    expect(result.current.showPreview).toBe(true)
    act(() => { result.current.cancelPreview() })
    await act(async () => { pending['C:\\dl\\big.7z']([{ archive: 'big.7z' }]) })

    expect(result.current.showPreview).toBe(false)
    expect(result.current.previewLoading).toBe(false)
    expect(result.current.previewData).toEqual([])
    expect(result.current.pendingInstallPaths).toEqual([])
  })

  it('a slow install finishing does not wipe the preview of an archive dropped meanwhile', async () => {
    const { pending, preview } = deferredPreviews()
    let finishInstall
    const install = vi.fn(() => new Promise(resolve => { finishInstall = resolve }))
    window.api = { mods: { scan: vi.fn(async () => []), preview, install }, conflicts: { scan: vi.fn(async () => []) } }
    const { toasts, props } = modProps()
    const { result } = renderHook(useModHandlers, props)

    act(() => { result.current.handleInstallWithPreview(['C:\\dl\\a.zip']) })
    await act(async () => { pending['C:\\dl\\a.zip']([{ archive: 'a.zip' }]) })
    act(() => { result.current.handleConfirmInstall() })
    expect(install).toHaveBeenCalledWith(['C:\\dl\\a.zip'])
    expect(result.current.showPreview).toBe(false)

    // B is dropped while A is still installing.
    act(() => { result.current.handleInstallWithPreview(['C:\\dl\\b.zip']) })
    await act(async () => { pending['C:\\dl\\b.zip']([{ archive: 'b.zip' }]) })
    await act(async () => { finishInstall() })
    await flush()

    expect(toasts).toContainEqual([en.toastInstalled, 'success'])
    expect(result.current.showPreview).toBe(true)
    expect(result.current.pendingInstallPaths).toEqual(['C:\\dl\\b.zip'])
    expect(result.current.previewData).toEqual([{ archive: 'b.zip' }])

    // B's Install button still installs B.
    act(() => { result.current.handleConfirmInstall() })
    expect(install).toHaveBeenLastCalledWith(['C:\\dl\\b.zip'])
    await act(async () => { finishInstall() })
  })
})

// --- App init: game path, launch ---------------------------------------------

function appInitApi(over = {}) {
  let pathSet = false
  const api = {
    game: {
      isRunning: vi.fn(async () => false),
      onRunning: vi.fn(() => () => {}),
      detectPath: vi.fn(async () => (pathSet ? 'D:\\SteamLibrary\\steamapps\\common\\HumanitZ' : null)),
      setPath: vi.fn(async () => { pathSet = true; return { valid: true } }),
      getVersionCached: vi.fn(async () => null),
      getVersion: vi.fn(async () => (pathSet ? '1.2.3' : null)),
      launch: vi.fn(async () => {}),
      ...over.game,
    },
    ue4ss: {
      onProgress: vi.fn(() => () => {}),
      getStatus: vi.fn(async () => (pathSet ? { status: 'installed', version: '3.0.1' } : { status: 'uninstalled' })),
    },
    system: { selectFolder: vi.fn(async () => 'D:\\SteamLibrary\\steamapps\\common\\HumanitZ') },
    conflicts: { scan: vi.fn(async () => []) },
  }
  return { api, markPathSet: () => { pathSet = true } }
}

describe('game path change re-queries UE4SS status and game version (gids 85, 135)', () => {
  it('after Browse, the dashboard sees the UE4SS install already in the new folder', async () => {
    const { api } = appInitApi()
    window.api = api
    const { addToast } = toastSpy()
    const refreshMods = vi.fn(async () => {})
    const { result } = renderHook(useAppInit, { addToast, t: en, refreshMods })
    await act(async () => { await result.current.initGame() })
    expect(result.current.ue4ssStatus).toBe('uninstalled')

    await act(async () => { await result.current.handleBrowsePath() })
    await flush()
    expect(result.current.ue4ssStatus).toBe('installed')
    expect(result.current.ue4ssVersion).toBe('3.0.1')
    expect(result.current.gameVersion).toBe('1.2.3')
    expect(refreshMods).toHaveBeenCalledTimes(1)
  })

  it('after Detect finds a path, the status is re-queried too', async () => {
    const { api, markPathSet } = appInitApi()
    window.api = api
    const { addToast } = toastSpy()
    const { result } = renderHook(useAppInit, { addToast, t: en, refreshMods: vi.fn(async () => {}) })
    await act(async () => { await result.current.initGame() })
    markPathSet()
    await act(async () => { await result.current.handleDetectPath() })
    await flush()
    expect(result.current.ue4ssStatus).toBe('installed')
    expect(api.ue4ss.getStatus).toHaveBeenCalledTimes(2)
  })
})

describe('launch with conflicts and launch errors (gids 116, 144)', () => {
  it('conflicts ask for confirmation instead of blocking, and confirming launches', async () => {
    const { api } = appInitApi()
    window.api = api
    const { toasts, addToast } = toastSpy()
    const { calls, showConfirm } = confirmSpy()
    const { result } = renderHook(useAppInit, { addToast, showConfirm, t: en, refreshMods: vi.fn(async () => {}) })
    act(() => { result.current.setConflicts([{ resource: 'HumanitZ/Content/DT_Items.uasset', mods: ['z1_A_P.pak', 'B_P.pak'] }]) })

    await act(async () => { await result.current.handleLaunch() })
    expect(api.game.launch).not.toHaveBeenCalled()
    expect(toasts).toEqual([])
    expect(calls).toHaveLength(1)
    expect(calls[0].title).toBe(en.conflictDetected)
    expect(calls[0].desc).toBe(en.launchConflictConfirm.replace('{n}', '1'))
    expect(calls[0].variant).toBe('warning')

    await act(async () => { await calls[0].onConfirm() })
    expect(api.game.launch).toHaveBeenCalledTimes(1)
    expect(result.current.launchState).toBe('launching')
  })

  it('without conflicts it launches directly', async () => {
    const { api } = appInitApi()
    window.api = api
    const { showConfirm } = confirmSpy()
    const { result } = renderHook(useAppInit, { addToast: vi.fn(), showConfirm, t: en, refreshMods: vi.fn(async () => {}) })
    await act(async () => { await result.current.handleLaunch() })
    expect(showConfirm).not.toHaveBeenCalled()
    expect(api.game.launch).toHaveBeenCalledTimes(1)
  })

  it('"Game path not set" is shown as the set-the-path toast', async () => {
    const { api } = appInitApi({ game: { launch: vi.fn(async () => { throw new Error("Error invoking remote method 'game:launch': Error: Game path not set") }) } })
    window.api = api
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { toasts, addToast } = toastSpy()
    const { result } = renderHook(useAppInit, { addToast, showConfirm: vi.fn(), t: en, refreshMods: vi.fn(async () => {}) })
    await act(async () => { await result.current.handleLaunch() })
    expect(result.current.launchState).toBe('idle')
    expect(toasts).toEqual([[en.toastEngineFailedNoPath, 'error']])
  })

  it('other launch errors are toasted with their message', async () => {
    const { api } = appInitApi({ game: { launch: vi.fn(async () => { throw new Error('Game executable not found') }) } })
    window.api = api
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { toasts, addToast } = toastSpy()
    const { result } = renderHook(useAppInit, { addToast, showConfirm: vi.fn(), t: en, refreshMods: vi.fn(async () => {}) })
    await act(async () => { await result.current.handleLaunch() })
    expect(result.current.launchState).toBe('idle')
    expect(toasts).toEqual([[`${en.toastLaunchFailed}: Game executable not found`, 'error']])
  })
})

// --- Nexus update checker ------------------------------------------------------

const outdated = (modId, files) => ({ modId, outdated: true, latestFileId: modId * 10, latestVersion: '2.0', currentVersion: '1.0', affectedFilenames: files })

function nexusApi(results, over = {}) {
  return {
    nexus: {
      checkUpdates: vi.fn(async () => ({ checkedAt: 0, results })),
      checkUpdatesForce: vi.fn(async () => ({ checkedAt: 0, results })),
      onDownloadProgress: vi.fn(() => () => {}),
      updateFile: vi.fn(async () => {}),
      ...over,
    },
  }
}

describe('one Nexus mod update at a time (gid 90)', () => {
  it('a second Update click and Update all are ignored while an update is in flight', async () => {
    const r1 = outdated(1, ['A_P.pak'])
    const r2 = outdated(2, ['B_P.pak'])
    const resolvers = []
    window.api = nexusApi([r1, r2], { updateFile: vi.fn(() => new Promise(resolve => resolvers.push(resolve))) })
    const { addToast } = toastSpy()
    const { result } = renderHook(useUpdateChecker, { nexusApiKey: 'key', addToast, t: en, refreshMods: vi.fn(async () => {}) })
    await flush()

    let first
    act(() => { first = result.current.handleUpdateMod(r1) })
    act(() => { result.current.handleUpdateMod(r2) })
    expect(window.api.nexus.updateFile).toHaveBeenCalledTimes(1)
    expect(result.current.updatingModId).toBe(1)

    await act(async () => { await result.current.handleUpdateAll() })
    expect(window.api.nexus.updateFile).toHaveBeenCalledTimes(1)
    expect(result.current.updateAllBusy).toBe(false)

    await act(async () => { resolvers[0](); await first })
    expect(result.current.updatingModId).toBe(null)

    // Free again: the next click goes through.
    let second
    act(() => { second = result.current.handleUpdateMod(r2) })
    expect(window.api.nexus.updateFile).toHaveBeenCalledTimes(2)
    await act(async () => { resolvers[1](); await second })
  })

  it('other cards\' Update buttons are disabled while one mod updates', () => {
    const map = new Map([[updateMapKey('A_P.pak'), outdated(1, ['A_P.pak'])], [updateMapKey('B_P.pak'), outdated(2, ['B_P.pak'])]])
    const modules = [
      { id: 'A_P.pak', filename: 'A_P.pak', type: 'PAK', enabled: true, title: 'A' },
      { id: 'B_P.pak', filename: 'B_P.pak', type: 'PAK', enabled: true, title: 'B' },
    ]
    const { el } = mountNode(<ModuleList {...listProps({ modules, modUpdateMap: map, updatingModId: 1 })} />)
    const buttons = [...el.querySelectorAll('button')].filter(b => b.querySelector('.lucide-circle-arrow-up, .lucide-arrow-up-circle'))
    expect(buttons).toHaveLength(2)
    expect(buttons.every(b => b.disabled)).toBe(true)
  })
})

describe('update badge survives a toggle or load-order rename (gids 94, 132)', () => {
  it('the map key ignores .disabled, the order prefix and case', () => {
    expect(updateMapKey('Foo_P.pak.disabled')).toBe(updateMapKey('Foo_P.pak'))
    expect(updateMapKey('z1_Foo_P.pak')).toBe(updateMapKey('Foo_P.pak'))
    expect(updateMapKey('010_foo_p.pak')).toBe(updateMapKey('Foo_P.pak'))
    expect(updateMapKey('Zebra_P.pak')).not.toBe(updateMapKey('bra_P.pak'))
  })

  it('a disabled pak still shows the Update button from a verdict taken while it was enabled', async () => {
    window.api = nexusApi([outdated(7, ['Foo_P.pak'])])
    const modules = [{ id: 'Foo_P.pak', filename: 'Foo_P.pak.disabled', type: 'PAK', enabled: false, title: 'Foo' }]
    function Host() {
      const { updateMap } = useUpdateChecker({ nexusApiKey: 'key', addToast: () => {}, t: en, refreshMods: async () => {} })
      return <ModuleList {...listProps({ modules, modUpdateMap: updateMap })} />
    }
    const { el } = mountNode(<Host />)
    await flush()
    const update = [...el.querySelectorAll('button')].find(b => b.getAttribute('title') === en.updateMod)
    expect(update).toBeTruthy()
  })
})

describe('startup update check runs once (gid 96)', () => {
  it('a language switch right after mount does not start a second check', async () => {
    window.api = nexusApi([])
    const props = { nexusApiKey: '', addToast: () => {}, refreshMods: async () => {} }
    const { rerender } = renderHook(useUpdateChecker, { ...props, t: UI_TEXT['zh-TW'] })
    await flush()
    rerender({ ...props, t: en })
    await flush()
    expect(window.api.nexus.checkUpdates).toHaveBeenCalledTimes(1)
  })
})

// --- ModuleList range anchor (gid 104) -------------------------------------------

function listProps(over = {}) {
  return {
    modules: [], type: 'PAK', title: 'PAK', icon: Package, colorClass: '',
    activeModuleId: null, onModuleClick: () => {}, onToggle: () => {}, onUninstallLocal: () => {},
    onRenameMod: () => {}, t: en, lang: 'en', selectedMods: new Set(),
    onToggleSelect: () => {}, onRangeSelect: () => {}, nexusApiKey: 'key',
    onUpdateMod: () => {}, updatingModId: null, updateProgress: null,
    ...over,
  }
}

describe('Shift+click range after a re-sort (gid 104)', () => {
  const mod = (name) => ({ id: `${name}_P.pak`, filename: `${name}_P.pak`, type: 'PAK', enabled: true, title: name })
  const click = (el, name, init) => {
    const h4 = [...el.querySelectorAll('h4')].find(h => h.textContent === name)
    act(() => { h4.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })) })
  }

  it('the range runs from the anchored mod in the new order', () => {
    const onToggleSelect = vi.fn()
    const onRangeSelect = vi.fn()
    const asc = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map(mod)
    const { el, rerender } = mountNode(<ModuleList {...listProps({ modules: asc, onToggleSelect, onRangeSelect })} />)
    click(el, 'Alpha', { ctrlKey: true })
    expect(onToggleSelect).toHaveBeenCalledWith('Alpha_P.pak')

    rerender(<ModuleList {...listProps({ modules: [...asc].reverse(), onToggleSelect, onRangeSelect })} />)
    click(el, 'Charlie', { shiftKey: true })
    expect(onRangeSelect).toHaveBeenCalledTimes(1)
    expect([...onRangeSelect.mock.calls[0][0]].sort()).toEqual(['Alpha_P.pak', 'Bravo_P.pak', 'Charlie_P.pak'])
  })

  it('an anchor that left the list falls back to a single toggle', () => {
    const onToggleSelect = vi.fn()
    const onRangeSelect = vi.fn()
    const all = ['Alpha', 'Bravo', 'Charlie'].map(mod)
    const { el, rerender } = mountNode(<ModuleList {...listProps({ modules: all, onToggleSelect, onRangeSelect })} />)
    click(el, 'Alpha', { ctrlKey: true })
    rerender(<ModuleList {...listProps({ modules: all.slice(1), onToggleSelect, onRangeSelect })} />)
    click(el, 'Charlie', { shiftKey: true })
    expect(onRangeSelect).not.toHaveBeenCalled()
    expect(onToggleSelect).toHaveBeenLastCalledWith('Charlie_P.pak')
  })
})

// --- Document language (gid 128) ------------------------------------------------

describe('document language follows the UI language (gid 128)', () => {
  it('App sets <html lang> from its language state', async () => {
    document.documentElement.lang = 'xx'
    mountNode(<App />)
    await flush()
    expect(document.documentElement.lang).toBe('zh-TW')
  })
})
