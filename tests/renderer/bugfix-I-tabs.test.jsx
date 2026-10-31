// @vitest-environment happy-dom
// Regression tests for the tab / common-component fixes: the Profiles tab's
// disabled-PAK lookup, the Nexus card's success flash and download progress,
// the Nexus sort-pill geometry after a language switch, the Modules search
// whitespace, the Sidebar version tag, Steam Workshop empty-page pagination,
// metadata-less backup rows, indeterminate (-1) progress bars and formatCount
// rounding.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { UI_TEXT } from '../../src/renderer/src/constants/i18n/index.js'
import ProfilesTab from '../../src/renderer/src/components/tabs/ProfilesTab.jsx'
import NexusTab from '../../src/renderer/src/components/tabs/NexusTab.jsx'
import ModulesTab from '../../src/renderer/src/components/tabs/ModulesTab.jsx'
import SteamWorkshopTab from '../../src/renderer/src/components/tabs/SteamWorkshopTab.jsx'
import SettingsTab from '../../src/renderer/src/components/tabs/SettingsTab.jsx'
import DashboardTab from '../../src/renderer/src/components/tabs/DashboardTab.jsx'
import Sidebar from '../../src/renderer/src/components/layout/Sidebar.jsx'
import NexusModCard from '../../src/renderer/src/components/common/NexusModCard.jsx'
import { formatCount, formatVersionTag, formatBackupTimestamp, knownPercent } from '../../src/renderer/src/components/common/utils.js'

// ModuleList belongs to another component suite; a stub that lists the PAK
// names it receives is enough to see what the Modules search kept.
vi.mock('../../src/renderer/src/components/common/ModuleList.jsx', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ modules, type }) => (type === 'PAK'
      ? createElement('ul', { 'data-testid': 'pak-list' }, modules.filter(m => m.type === 'PAK').map(m => createElement('li', { key: m.filename }, m.customName || m.title)))
      : null),
  }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const t = UI_TEXT.en
const zh = UI_TEXT['zh-TW']

const mounted = []
function mount(node) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => root.render(node))
  mounted.push({ root, el })
  return { el, rerender: (n) => act(() => root.render(n)) }
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

const restoreProps = []
afterEach(() => {
  for (const { root, el } of mounted.splice(0)) {
    act(() => root.unmount())
    el.remove()
  }
  document.body.innerHTML = ''
  for (const fn of restoreProps.splice(0)) fn()
  vi.restoreAllMocks()
  vi.useRealTimers()
  delete window.api
})

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// ---------------------------------------------------------------------------
describe('ProfilesTab — profile entries for currently-disabled PAKs', () => {
  it('resolves a .disabled PAK to its module (PAK group, custom name)', () => {
    const modules = [{ filename: 'Foo_P.pak.disabled', type: 'PAK', enabled: false, title: 'Foo_P', customName: 'My Renamed Foo' }]
    const profiles = [{ id: 'p1', name: 'Profile A', enabledModFilenames: ['Foo_P.pak'], createdAt: '2026-01-01' }]
    const { el } = mount(
      <ProfilesTab t={t} modules={modules} profiles={profiles} activeProfileId={null} newProfileName="" setNewProfileName={() => {}}
        handleCreateProfile={() => {}} handleApplyProfile={() => {}} handleDeleteProfile={() => {}} handleExportProfile={() => {}}
        handleImportProfile={() => {}} applyingProfileId={null} importModal={null} closeImportModal={() => {}} />
    )
    const text = el.textContent
    expect(text).toContain(t.profileGroupPak)
    expect(text).toContain('My Renamed Foo')
    expect(text).not.toContain(t.profileGroupOther)
  })
})

// ---------------------------------------------------------------------------
function nexusApi(overrides = {}) {
  const progressListeners = new Set()
  const api = {
    nexus: {
      validate: vi.fn(async () => ({ ok: true, name: 'Tester' })),
      listMods: vi.fn(async () => ({ ok: true, mods: [{ modId: 5, name: 'Backpack Plus', author: 'someone', summary: 's', downloads: 10, endorsements: 2 }], totalCount: 1 })),
      searchMods: vi.fn(async () => ({ ok: true, mods: [], totalCount: 0 })),
      getInstalledMods: vi.fn(async () => []),
      getModFiles: vi.fn(async () => ({ ok: true, files: [{ file_id: 11, category_id: 1, name: 'Main' }] })),
      installMod: vi.fn(async () => ({ ok: true })),
      installFile: vi.fn(async () => ({ ok: true })),
      clearCache: vi.fn(async () => {}),
      onDownloadProgress: vi.fn((cb) => { progressListeners.add(cb); return () => progressListeners.delete(cb) }),
      ...overrides,
    },
    mods: { onUpdated: vi.fn(() => () => {}) },
    system: { openExternal: vi.fn() },
  }
  const emitProgress = (p) => act(() => { for (const cb of [...progressListeners]) cb(p) })
  return { api, emitProgress, progressListeners }
}

async function mountNexus(api, tt = t) {
  window.api = api
  const addToast = vi.fn()
  const node = (x) => <NexusTab t={x} lang="en" addToast={addToast} setActiveTab={() => {}} />
  const h = mount(node(tt))
  // validate resolves and mounts the browse UI; then listMods resolves and
  // the 550ms bootup gate opens.
  await flush()
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  return { ...h, addToast, rerenderT: (x) => h.rerender(node(x)) }
}
const cardButton = (el) => el.querySelector(`button[title="${t.nexusInstallLatest}"]`)
const cardLabel = (el) => cardButton(el).querySelector('span').textContent

describe('NexusTab quick install — success flash only on success', () => {
  it('a failed install does not show the green Installed state', async () => {
    vi.useFakeTimers()
    const { api } = nexusApi({ installMod: vi.fn(async () => { throw new Error('HTTP 403') }) })
    const { el, addToast } = await mountNexus(api)
    expect(cardLabel(el)).toBe(t.nexusInstall)
    act(() => cardButton(el).click())
    await flush()
    expect(addToast).toHaveBeenCalledWith(expect.stringContaining('HTTP 403'), 'error')
    expect(cardLabel(el)).toBe(t.nexusInstall)
    expect(cardButton(el).disabled).toBe(false)
    expect(cardButton(el).className).not.toContain('bg-emerald-500')
  })

  it('opening the multi-file picker does not show the green Installed state', async () => {
    vi.useFakeTimers()
    const files = [
      { file_id: 1, category_id: 1, name: 'Vanilla', uploaded_timestamp: 100 },
      { file_id: 2, category_id: 1, name: 'Modded', uploaded_timestamp: 200 },
    ]
    const { api } = nexusApi({ getModFiles: vi.fn(async () => ({ ok: true, files })) })
    const { el } = await mountNexus(api)
    act(() => cardButton(el).click())
    await flush()
    expect(document.body.textContent).toContain(t.nexusSelectVersion)
    expect(api.nexus.installMod).not.toHaveBeenCalled()
    expect(cardLabel(el)).toBe(t.nexusInstall)
    expect(cardButton(el).className).not.toContain('bg-emerald-500')
  })

  it('a successful install flashes Installed, then clears', async () => {
    vi.useFakeTimers()
    const { api } = nexusApi()
    const { el } = await mountNexus(api)
    act(() => cardButton(el).click())
    await flush()
    expect(api.nexus.installMod).toHaveBeenCalledWith(5)
    expect(cardLabel(el)).toBe(t.nexusInstalledToast)
    expect(cardButton(el).className).toContain('bg-emerald-500')
    await act(async () => { await vi.advanceTimersByTimeAsync(1700) })
    expect(cardLabel(el)).toBe(t.nexusInstall)
    expect(cardButton(el).disabled).toBe(false)
  })
})

describe('NexusTab quick install — download progress', () => {
  it('maps -1 (unknown size) to the indeterminate label instead of "-1%"', async () => {
    vi.useFakeTimers()
    const install = deferred()
    const { api, emitProgress } = nexusApi({ installMod: vi.fn(() => install.promise) })
    const { el } = await mountNexus(api)
    act(() => cardButton(el).click())
    await flush()
    emitProgress(-1)
    expect(cardLabel(el)).toBe(t.nexusInstalling)
    emitProgress(42)
    expect(cardLabel(el)).toBe('42%')
    await act(async () => { install.resolve({ ok: true }); await vi.advanceTimersByTimeAsync(0) })
  })

  it('progress from another download before the click does not leak onto the card', async () => {
    vi.useFakeTimers()
    const files = deferred()
    const { api, emitProgress } = nexusApi({ getModFiles: vi.fn(() => files.promise) })
    const { el } = await mountNexus(api)
    // e.g. an nxm:// download finishing while the tab is open
    emitProgress(100)
    act(() => cardButton(el).click())
    await flush()
    expect(cardLabel(el)).toBe(t.nexusInstalling)
    await act(async () => { files.resolve({ ok: false, reason: 'x' }); await vi.advanceTimersByTimeAsync(0) })
  })
})

describe('NexusTab sort pill — re-measured on language switch', () => {
  it('tracks the active segment geometry after t changes', async () => {
    vi.useFakeTimers()
    // Fake layout: a segment button is as wide as its label.
    const proto = window.HTMLElement.prototype
    const widthOf = (n) => (n.tagName === 'BUTTON' ? 20 + n.textContent.length * 7 : 0)
    for (const prop of ['offsetWidth', 'offsetLeft']) {
      const orig = Object.getOwnPropertyDescriptor(proto, prop)
      restoreProps.push(() => { if (orig) Object.defineProperty(proto, prop, orig); else delete proto[prop] })
    }
    Object.defineProperty(proto, 'offsetWidth', { configurable: true, get() { return widthOf(this) } })
    Object.defineProperty(proto, 'offsetLeft', {
      configurable: true,
      get() {
        let left = 0
        for (let s = this.previousElementSibling; s; s = s.previousElementSibling) left += widthOf(s)
        return left
      },
    })

    const { api } = nexusApi()
    const { el, rerenderT } = await mountNexus(api)
    const segBtn = (label) => [...el.querySelectorAll('button')].find(b => b.textContent === label)
    act(() => segBtn(t.nexusMostDownloaded).click())
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    const btn = segBtn(t.nexusMostDownloaded)
    const pill = btn.parentElement.querySelector(':scope > div[aria-hidden]')
    const en = { left: btn.offsetLeft, width: btn.offsetWidth }
    expect(en.left).toBeGreaterThan(0)
    expect(pill.style.left).toBe(`${en.left}px`)
    expect(pill.style.width).toBe(`${en.width}px`)

    rerenderT(zh)
    await flush()
    expect(btn.textContent).toBe(zh.nexusMostDownloaded)
    expect(btn.offsetWidth).not.toBe(en.width)
    expect(pill.style.left).toBe(`${btn.offsetLeft}px`)
    expect(pill.style.width).toBe(`${btn.offsetWidth}px`)
  })
})

describe('NexusModCard', () => {
  const mod = { modId: 1, name: 'M', mod_downloads: 999950, endorsement_count: 9999 }
  it('installing going true -> false alone does not flash success', () => {
    const props = { mod, t, onClick: () => {}, onQuickInstall: () => {}, installingAny: false, installed: false }
    const { el, rerender } = mount(<NexusModCard {...props} installing installingAny />)
    rerender(<NexusModCard {...props} installing={false} />)
    expect(el.querySelector('button').textContent).toBe(t.nexusInstall)
    rerender(<NexusModCard {...props} installing={false} succeeded />)
    expect(el.querySelector('button').textContent).toBe(t.nexusInstalledToast)
  })
  it('uses the shared formatCount (no "1000k" / "10.0k")', () => {
    const { el } = mount(<NexusModCard mod={mod} t={t} onClick={() => {}} onQuickInstall={() => {}} installing={false} installingAny={false} installed={false} />)
    expect(el.textContent).toContain('1.0M')
    expect(el.textContent).toContain('10k')
    expect(el.textContent).not.toContain('1000k')
  })
})

// ---------------------------------------------------------------------------
describe('ModulesTab search', () => {
  const modules = [
    { filename: 'Backpack_P.pak', title: 'Backpack', type: 'PAK', enabled: true },
    { filename: 'Other_P.pak', title: 'Other Thing', type: 'PAK', enabled: true },
  ]
  const render = (searchQuery) => mount(
    <ModulesTab t={t} lang="en" modules={modules} searchQuery={searchQuery} setSearchQuery={() => {}}
      filterType="all" setFilterType={() => {}} sortBy="name" setSortBy={() => {}}
      selectedMods={new Set()} setSelectedMods={() => {}} conflicts={[]} />
  )
  it('ignores leading/trailing whitespace in the query', () => {
    const { el } = render('  backpack ')
    const list = el.querySelector('[data-testid="pak-list"]')
    expect(list).not.toBeNull()
    expect([...list.querySelectorAll('li')].map(li => li.textContent)).toEqual(['Backpack'])
  })
})

// ---------------------------------------------------------------------------
describe('Sidebar update pill', () => {
  const props = {
    activeTab: 'dashboard', setActiveTab: () => {}, setActiveModuleId: () => {}, appIcon: '', t,
    isGameRunning: false, launchState: 'idle', gameVersion: null, handleLaunch: () => {}, appVersion: '1.7.0',
    updateState: 'available', modUpdateCount: 0,
  }
  it('does not double the v of a GitHub tag', () => {
    const { el } = mount(<Sidebar {...props} updateInfo={{ latestVersion: 'v1.8.0' }} />)
    expect(el.textContent).toContain('v1.8.0')
    expect(el.textContent).not.toContain('vv1.8.0')
  })
  it('still prefixes a bare version', () => {
    const { el } = mount(<Sidebar {...props} updateInfo={{ latestVersion: '1.8.0' }} />)
    expect(el.textContent).toContain('v1.8.0')
  })
})

// ---------------------------------------------------------------------------
describe('SteamWorkshopTab pagination', () => {
  it('keeps Previous reachable on an empty page past the first', async () => {
    vi.useFakeTimers()
    const full = Array.from({ length: 30 }, (_, i) => ({ id: String(i), title: `Item ${i}`, subscriptions: i }))
    const browse = vi.fn(async ({ page }) => (page === 1 ? { ok: true, items: full, hasNext: true } : { ok: true, items: [], hasNext: false }))
    window.api = { steam: { browse } }
    const { el } = mount(<SteamWorkshopTab t={t} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    act(() => el.querySelector(`button[aria-label="${t.nextPage}"]`).click())
    await flush()
    expect(el.textContent).toContain(t.steamWorkshopEmpty)
    const prev = el.querySelector(`button[aria-label="${t.previousPage}"]`)
    expect(prev).not.toBeNull()
    expect(prev.disabled).toBe(false)
    expect(el.querySelector(`button[aria-label="${t.nextPage}"]`).disabled).toBe(true)
    act(() => prev.click())
    await flush()
    expect(browse).toHaveBeenLastCalledWith({ sort: 'trend', page: 1, search: '' })
    expect(el.textContent).toContain('Item 0')
  })

  it('shows no pagination for an empty first page', async () => {
    vi.useFakeTimers()
    window.api = { steam: { browse: vi.fn(async () => ({ ok: true, items: [], hasNext: false })) } }
    const { el } = mount(<SteamWorkshopTab t={t} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(el.textContent).toContain(t.steamWorkshopEmpty)
    expect(el.querySelector(`button[aria-label="${t.previousPage}"]`)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
const settingsProps = {
  t, lang: 'en', isDark: false, themeId: 'default', toggleDark: () => {}, changeTheme: () => {},
  gamePath: '', detecting: false, handleDetectPath: () => {}, handleBrowsePath: () => {},
  handleConflictScan: () => {}, handleOpenLogs: () => {}, appVersion: '1.7.0',
  updateState: 'idle', updateInfo: null, updateProgress: 0, handleCheckUpdate: () => {},
  handleDownloadUpdate: () => {}, handleInstallUpdate: () => {}, updateError: null,
  backups: [], backupLoading: false, handleBackup: () => {}, handleRestoreBackup: () => {}, handleDeleteBackup: () => {},
  nexusApiKey: '', handleSetNexusApiKey: () => {}, nxmEnabled: false, handleSetNxmEnabled: () => {},
  minimizeToTray: false, handleSetMinimizeToTray: () => {}, autoStart: false, handleSetAutoStart: () => {},
  skipInstallPreview: false, handleSetSkipInstallPreview: () => {}, uiZoom: 1, handleSetUiZoom: () => {},
}

describe('SettingsTab backup row without metadata', () => {
  it('shows a row-specific label and a readable time', () => {
    const backups = [{ name: 'save_backup_2026-01-02T03-04-05', path: 'C:\\b\\save_backup_2026-01-02T03-04-05', timestamp: '2026-01-02T03-04-05', legacy: false }]
    const { el } = mount(<SettingsTab {...settingsProps} backups={backups} />)
    expect(el.textContent).toContain(t.backupNoDetails)
    expect(el.textContent).not.toContain(t.backupEmpty)
    expect(el.textContent).toContain('2026/01/02 03:04:05')
  })
})

describe('Indeterminate (-1) progress bars', () => {
  it('SettingsTab update download does not render "-1%"', () => {
    const { el } = mount(<SettingsTab {...settingsProps} updateState="downloading" updateProgress={-1} />)
    expect(el.textContent).not.toContain('-1%')
    expect(el.innerHTML).not.toContain('width: -1%')
  })
  it('SettingsTab still renders a known percentage', () => {
    const { el } = mount(<SettingsTab {...settingsProps} updateState="downloading" updateProgress={37.4} />)
    expect(el.textContent).toContain('37%')
  })

  const dashProps = {
    t, modules: [], isDragging: false, setIsDragging: () => {}, fileInputRef: { current: null }, handleDrop: () => {},
    handleImportFiles: () => {}, ue4ssStatus: 'ok', ue4ssVersion: '3.0', handleUe4ssAction: () => {},
    handleUe4ssManualInstall: () => {}, handleInstallWithPreview: () => {}, conflicts: [], handleConflictScan: () => {},
    backupLoading: false, handleBackup: () => {}, onOpenModules: () => {},
  }
  it('Dashboard UE4SS bar does not render "-1%"', () => {
    const { el } = mount(<DashboardTab {...dashProps} isProcessing ue4ssProgress={-1} backups={[]} />)
    expect(el.textContent).not.toContain('-1%')
    expect(el.innerHTML).not.toContain('width: -1%')
  })
  it('Dashboard last-backup date strips the auto_ prefix of a metadata-less auto backup', () => {
    const backups = [{ name: 'save_backup_auto_2026-01-02T03-04-05', path: 'x', timestamp: 'auto_2026-01-02T03-04-05', legacy: false }]
    const { el } = mount(<DashboardTab {...dashProps} isProcessing={false} ue4ssProgress={0} backups={backups} />)
    expect(el.textContent).toContain(`${t.dashLastBackup} · 2026/01/02`)
    expect(el.textContent).not.toContain('auto_')
  })
})

// ---------------------------------------------------------------------------
describe('common/utils helpers', () => {
  it('formatCount rounds before picking the unit', () => {
    expect(formatCount(9999)).toBe('10k')
    expect(formatCount(9949)).toBe('9.9k')
    expect(formatCount(999499)).toBe('999k')
    expect(formatCount(999500)).toBe('1.0M')
    expect(formatCount(999950)).toBe('1.0M')
    expect(formatCount(9999999)).toBe('10M')
    expect(formatCount(1000)).toBe('1.0k')
  })
  it('formatVersionTag adds exactly one v', () => {
    expect(formatVersionTag('v1.8.0')).toBe('v1.8.0')
    expect(formatVersionTag('1.8.0')).toBe('v1.8.0')
    expect(formatVersionTag('')).toBe('')
    expect(formatVersionTag(null)).toBe('')
  })
  it('formatBackupTimestamp keeps the time colons and drops auto_', () => {
    expect(formatBackupTimestamp('2026-01-02T03-04-05')).toBe('2026/01/02 03:04:05')
    expect(formatBackupTimestamp('auto_2026-01-02T03-04-05')).toBe('2026/01/02 03:04:05')
    expect(formatBackupTimestamp('auto_2026-01-02T03-04-05', true)).toBe('2026/01/02')
    expect(formatBackupTimestamp('weird')).toBe('weird')
    expect(formatBackupTimestamp(undefined)).toBe('')
  })
  it('knownPercent maps the -1 sentinel and junk to null', () => {
    expect(knownPercent(-1)).toBeNull()
    expect(knownPercent(null)).toBeNull()
    expect(knownPercent(NaN)).toBeNull()
    expect(knownPercent(0)).toBe(0)
    expect(knownPercent(55)).toBe(55)
  })
})
