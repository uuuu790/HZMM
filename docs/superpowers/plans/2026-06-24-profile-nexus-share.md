# Profile Nexus-Source Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let exported profiles carry each mod's Nexus source so importers auto-download missing mods, with a manual-install fallback list for the rest.

**Architecture:** On export, reverse-look-up each enabled mod's Nexus install receipt (`nexusInstalledMods`) to attach a `nexusSources` array to the profile. On apply, classify the profile's wanted mods into present / auto-downloadable / manual, show a modal, auto-download the downloadable ones (original `fileId` with latest-version fallback), then run the existing apply logic. Pure functions hold the reverse-lookup and classification logic for testability; IPC/UI wrap them.

**Tech Stack:** Electron (main IPC + preload bridge) + React 18 renderer; Vitest (happy-dom, mock-fs) for tests; existing Nexus V1 download pipeline (`nexus:install-file`).

## Global Constraints

- **API key is NEVER exported.** Profile JSON must not contain any key; importers download with their own key.
- **Backward compatible:** profiles without `nexusSources` apply exactly as before (no detection, no download). Import validation still only requires `name` + `enabledModFilenames`.
- **Version lock + fallback:** download the original `fileId`; on delist (resolve failure) fall back to the mod's latest main file and flag it.
- **Premium gating unchanged:** auto-download needs the importer's Premium key (`nexus:validate` → `is_premium`); mods that can't auto-download go to the manual list.
- `nexusSources` entry shape (exact): `{ filename, modId, fileId, version, displayName }` — `filename` is the normalized (`.disabled`-stripped) enabled filename.
- Filename normalization = strip a trailing `.disabled` (case-insensitive), matching `profile-utils.js` `normalizeFilename`.
- Commit style: Conventional Commits.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/main/ipc/nexus-install-tracker.js` | Install receipts + reverse lookup | Add pure `matchSourcesToMods()` |
| `src/main/ipc/nexus.js` | Nexus IPC | Register `profiles:resolve-nexus-sources`; add `fileId` fallback to `nexus:install-file` |
| `src/preload/index.js` | IPC bridge | Expose `nexus.resolveProfileSources`; `installFile` gains a `fallbackToLatest` arg |
| `src/renderer/src/hooks/profile-nexus-utils.js` | Missing-mod classification | **New** pure `classifyProfileMods()` |
| `src/renderer/src/hooks/useProfileHandlers.js` | Profile state/actions | Export attaches sources; apply detects missing + drives download |
| `src/renderer/src/components/modals/ProfileImportModal.jsx` | Missing-mod modal | **New** |
| `src/renderer/src/components/tabs/ProfilesTab.jsx` | Profiles UI | Render the modal |
| `src/renderer/src/constants/i18n/*.js` (×7) | Strings | New keys |
| `tests/ipc/nexus-source-match.test.js` | Reverse-lookup test | **New** |
| `tests/renderer/profile-nexus-utils.test.js` | Classification test | **New** |

---

## Task 1: Backend reverse-lookup (filenames → Nexus sources)

**Files:**
- Modify: `src/main/ipc/nexus-install-tracker.js` (add pure function near `localModKey`, line 59-71)
- Modify: `src/main/ipc/nexus.js` (register IPC; `registerNexusIpc` body, before the closing `}` at line 205)
- Modify: `src/preload/index.js` (nexus block, after line 81)
- Test: `tests/ipc/nexus-source-match.test.js`

**Interfaces:**
- Produces: `matchSourcesToMods(receipts, mods, wantedFilenames) → [{filename, modId, fileId, version, displayName}]` (exported, pure). IPC `profiles:resolve-nexus-sources(enabledModFilenames) → sources[]`. Preload `window.api.nexus.resolveProfileSources(filenames)`.

- [ ] **Step 1: Write the failing test**

Create `tests/ipc/nexus-source-match.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { matchSourcesToMods } from '../../src/main/ipc/nexus-install-tracker.js'

const receipts = [
  { modId: 10, fileId: 100, version: '1.2', localMods: [{ name: 'CoolPak', modType: 'PAK' }] },
  { modId: 20, fileId: 200, version: null, localMods: [{ name: 'ScriptMod', modType: 'UE4SS' }] },
]
const mods = [
  { filename: 'CoolPak.pak', type: 'PAK', title: 'Cool Pak' },
  { filename: 'ScriptMod', type: 'UE4SS', title: 'Script Mod' },
  { filename: 'HandMade.pak', type: 'PAK', title: 'Hand Made' }, // no receipt
]

describe('matchSourcesToMods', () => {
  it('maps enabled filenames to their Nexus receipt source', () => {
    const out = matchSourcesToMods(receipts, mods, ['CoolPak.pak', 'ScriptMod'])
    expect(out).toEqual([
      { filename: 'CoolPak.pak', modId: 10, fileId: 100, version: '1.2', displayName: 'Cool Pak' },
      { filename: 'ScriptMod', modId: 20, fileId: 200, version: null, displayName: 'Script Mod' },
    ])
  })

  it('omits mods with no matching receipt (manual installs)', () => {
    const out = matchSourcesToMods(receipts, mods, ['HandMade.pak'])
    expect(out).toEqual([])
  })

  it('normalizes a .disabled wanted filename before matching', () => {
    const out = matchSourcesToMods(receipts, mods, ['CoolPak.pak.disabled'])
    expect(out.map(s => s.modId)).toEqual([10])
  })

  it('returns [] for empty/invalid input', () => {
    expect(matchSourcesToMods([], mods, ['x'])).toEqual([])
    expect(matchSourcesToMods(receipts, mods, [])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ipc/nexus-source-match.test.js`
Expected: FAIL — `matchSourcesToMods is not a function`.

- [ ] **Step 3: Implement `matchSourcesToMods`**

In `src/main/ipc/nexus-install-tracker.js`, after the `localModKey` function (after line 71), add:

```js
// Strip a trailing `.disabled` so a toggled PAK matches its enabled name.
// (Mirrors renderer profile-utils.normalizeFilename — kept inline so the
// main process doesn't import renderer code.)
function stripDisabled(filename) {
  return typeof filename === 'string' ? filename.replace(/\.disabled$/i, '') : ''
}

// Pure reverse lookup: for each wanted (enabled) filename, find the Nexus
// install receipt whose landed localMods include the matching on-disk mod, and
// emit its source. Mods with no receipt (manual installs) are omitted.
//
// receipts: nexusInstalledMods entries. mods: scanMods() result. wantedFilenames:
// a profile's enabledModFilenames. Returns one entry per matched filename.
export function matchSourcesToMods(receipts, mods, wantedFilenames) {
  if (!Array.isArray(receipts) || !Array.isArray(mods) || !Array.isArray(wantedFilenames)) return []
  if (receipts.length === 0 || wantedFilenames.length === 0) return []

  // receipt localMod key (`${modType}:${name}`) → receipt
  const keyToReceipt = new Map()
  for (const r of receipts) {
    if (!r || !r.modId || !Array.isArray(r.localMods)) continue
    for (const lm of r.localMods) {
      if (lm && lm.name && lm.modType) keyToReceipt.set(`${lm.modType}:${lm.name}`, r)
    }
  }

  const wanted = new Set(wantedFilenames.map(stripDisabled).filter(Boolean))
  const out = []
  const seen = new Set()
  for (const m of mods) {
    const fn = stripDisabled(m.filename)
    if (!wanted.has(fn)) continue
    const key = localModKey(m) // `PAK:base` / `UE4SS:folder`
    if (!key) continue
    // localModKey gives `TYPE:base`; receipt keys are `modType:name` — same shape.
    const r = keyToReceipt.get(key.replace(/^PAK:/, 'PAK:').replace(/^UE4SS:/, 'UE4SS:'))
    if (!r) continue
    if (seen.has(fn)) continue
    seen.add(fn)
    out.push({
      filename: fn,
      modId: r.modId,
      fileId: r.fileId || null,
      version: r.version || null,
      displayName: m.title || m.filename,
    })
  }
  return out
}
```

> Note: `localModKey` returns `PAK:<base>` / `UE4SS:<folder>` and receipts store `localMods[].name` already stripped, so `key` and the receipt key (`${modType}:${name}`) align directly. The `.replace` calls above are no-ops kept only to make the intent explicit — you may drop them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ipc/nexus-source-match.test.js`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Register the IPC handler**

In `src/main/ipc/nexus.js`, inside `registerNexusIpc`, just before the final `ipcMain.handle('nexus:clear-cache', ...)` (line 204), add:

```js
  // Reverse-look-up Nexus sources for a profile's enabled filenames, so an
  // exported profile can carry where each mod came from. Reads receipts +
  // scanMods; pure matching lives in matchSourcesToMods.
  ipcMain.handle('profiles:resolve-nexus-sources', (_, enabledModFilenames) => {
    try {
      const receipts = configStore.get('nexusInstalledMods', [])
      const mods = scanMods()
      return matchSourcesToMods(receipts, mods, Array.isArray(enabledModFilenames) ? enabledModFilenames : [])
    } catch (err) {
      logger.warn(`profiles:resolve-nexus-sources failed: ${err.message}`)
      return []
    }
  })
```

Add `matchSourcesToMods` and `scanMods` to the imports at the top of `nexus.js` if not already imported. Check the existing import from `./nexus-install-tracker.js` (line ~33 imports `recordInstall, flattenLandedMods`) and add `matchSourcesToMods`; add `import { scanMods } from './mods-scan.js'` if absent.

- [ ] **Step 6: Expose in preload**

In `src/preload/index.js`, in the `nexus:` block, after line 81 (`getInstalledMods`), add:

```js
    resolveProfileSources: (filenames) => ipcRenderer.invoke('profiles:resolve-nexus-sources', filenames),
```

- [ ] **Step 7: Run full suite + commit**

Run: `npx vitest run tests/ipc/nexus-source-match.test.js` (PASS), then `npm run lint` (clean).

```bash
git add src/main/ipc/nexus-install-tracker.js src/main/ipc/nexus.js src/preload/index.js tests/ipc/nexus-source-match.test.js
git commit -m "feat: reverse-look-up Nexus sources for profile filenames"
```

---

## Task 2: install-file fileId fallback to latest

**Files:**
- Modify: `src/main/ipc/nexus.js` (`nexus:install-file` handler, line 147-197)
- Modify: `src/preload/index.js` (`installFile`, line 80)

**Interfaces:**
- Consumes: `resolveNexusDownloadUrl({game, modId, fileId}, apiKey)` — with `fileId: null` it resolves the latest main file (mods-download.js:92-101).
- Produces: `nexus:install-file(modId, fileId, version, fallbackToLatest?)`. Preload `installFile(modId, fileId, version, fallbackToLatest)`.

- [ ] **Step 1: Add the fallback in the handler**

In `src/main/ipc/nexus.js`, change the handler signature (line 147) and wrap the resolve call. Replace lines 147 and 157 region:

Signature (line 147):
```js
  ipcMain.handle('nexus:install-file', async (_, modId, fileId, version, fallbackToLatest = false) => {
```

Replace the single resolve line (line 157):
```js
      const resolved = await resolveNexusDownloadUrl({ game: GAME_DOMAIN, modId, fileId }, apiKey)
```
with:
```js
      let resolved
      try {
        resolved = await resolveNexusDownloadUrl({ game: GAME_DOMAIN, modId, fileId }, apiKey)
      } catch (err) {
        // The pinned file may have been delisted. When the caller opted in
        // (profile auto-install), retry with the mod's latest main file.
        if (!fallbackToLatest) throw err
        logger.warn(`install-file ${modId}:${fileId} resolve failed, falling back to latest: ${err.message}`)
        resolved = await resolveNexusDownloadUrl({ game: GAME_DOMAIN, modId, fileId: null }, apiKey)
      }
```

(The rest of the handler — allowlist check, download, install, `recordInstall` — is unchanged. `recordInstall` already records whatever `fileId` was passed; the receipt keeps the requested fileId, which is acceptable.)

- [ ] **Step 2: Thread the arg through preload**

In `src/preload/index.js` line 80, change:
```js
    installFile: (modId, fileId, version) => ipcRenderer.invoke('nexus:install-file', modId, fileId, version),
```
to:
```js
    installFile: (modId, fileId, version, fallbackToLatest) => ipcRenderer.invoke('nexus:install-file', modId, fileId, version, fallbackToLatest),
```

- [ ] **Step 3: Lint + commit**

Run: `npm run lint` (clean). Existing `installFile` callers pass 3 args → `fallbackToLatest` is `undefined` → falsy → unchanged behavior.

```bash
git add src/main/ipc/nexus.js src/preload/index.js
git commit -m "feat: add latest-version fallback to nexus:install-file"
```

---

## Task 3: classifyProfileMods pure function

**Files:**
- Create: `src/renderer/src/hooks/profile-nexus-utils.js`
- Test: `tests/renderer/profile-nexus-utils.test.js`

**Interfaces:**
- Consumes: `normalizeFilename` from `./profile-utils.js`.
- Produces: `classifyProfileMods(profile, modules, hasPremiumKey) → { missing: string[], auto: source[], manual: (source|{filename, displayName})[] }`.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/profile-nexus-utils.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { classifyProfileMods } from '../../src/renderer/src/hooks/profile-nexus-utils.js'

const profile = {
  enabledModFilenames: ['A.pak', 'B', 'C.pak', 'D'],
  nexusSources: [
    { filename: 'C.pak', modId: 1, fileId: 11, version: '1.0', displayName: 'C Mod' },
    { filename: 'D', modId: 2, fileId: 22, version: null, displayName: 'D Mod' },
  ],
}
const modules = [{ filename: 'A.pak' }, { filename: 'B' }] // C and D are missing

describe('classifyProfileMods', () => {
  it('splits missing mods into auto (has source + premium) and manual', () => {
    const r = classifyProfileMods(profile, modules, true)
    expect(r.missing.sort()).toEqual(['C.pak', 'D'])
    expect(r.auto.map(s => s.modId).sort()).toEqual([1, 2])
    expect(r.manual).toEqual([])
  })

  it('without premium key, sourced mods go to manual', () => {
    const r = classifyProfileMods(profile, modules, false)
    expect(r.auto).toEqual([])
    expect(r.manual.map(s => s.filename).sort()).toEqual(['C.pak', 'D'])
  })

  it('a missing mod with no source is always manual (name only)', () => {
    const p = { enabledModFilenames: ['Z.pak'], nexusSources: [] }
    const r = classifyProfileMods(p, [], true)
    expect(r.manual).toEqual([{ filename: 'Z.pak', displayName: 'Z.pak' }])
  })

  it('nothing missing → empty buckets', () => {
    const r = classifyProfileMods(profile, [{ filename: 'A.pak' }, { filename: 'B' }, { filename: 'C.pak' }, { filename: 'D' }], true)
    expect(r.missing).toEqual([])
    expect(r.auto).toEqual([])
    expect(r.manual).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/profile-nexus-utils.test.js`
Expected: FAIL — module not found / not a function.

- [ ] **Step 3: Implement**

Create `src/renderer/src/hooks/profile-nexus-utils.js`:

```js
import { normalizeFilename } from './profile-utils.js';

// Classify a profile's wanted mods against what's installed locally:
//   missing  — wanted filenames not present on disk
//   auto     — missing mods that have a Nexus source AND the user has a Premium key
//   manual   — missing mods to fetch by hand (no source, or no Premium key)
//              (source object when known, else { filename, displayName })
export function classifyProfileMods(profile, modules, hasPremiumKey) {
  const present = new Set((modules || []).map(m => normalizeFilename(m.filename)));
  const wanted = (profile?.enabledModFilenames || []).map(normalizeFilename).filter(Boolean);
  const sourceByFn = new Map((profile?.nexusSources || []).map(s => [normalizeFilename(s.filename), s]));

  const missing = wanted.filter(fn => !present.has(fn));
  const auto = [];
  const manual = [];
  for (const fn of missing) {
    const src = sourceByFn.get(fn);
    if (src && hasPremiumKey) auto.push(src);
    else manual.push(src || { filename: fn, displayName: fn });
  }
  return { missing, auto, manual };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/profile-nexus-utils.test.js`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/profile-nexus-utils.js tests/renderer/profile-nexus-utils.test.js
git commit -m "feat: add classifyProfileMods for profile import detection"
```

---

## Task 4: Export attaches nexusSources

**Files:**
- Modify: `src/renderer/src/hooks/useProfileHandlers.js` (`handleExportProfile`, line 74-86)

**Interfaces:**
- Consumes: `window.api.nexus.resolveProfileSources(filenames)` (Task 1).

- [ ] **Step 1: Make export async + attach sources**

In `src/renderer/src/hooks/useProfileHandlers.js`, replace `handleExportProfile` (line 74-86) with:

```js
  const handleExportProfile = useCallback(async (profileId) => {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;
    // Attach where each enabled mod came from on Nexus, so importers can
    // auto-download the missing ones. Best-effort: on failure, export without.
    let nexusSources = [];
    try {
      nexusSources = await window.api?.nexus?.resolveProfileSources?.(profile.enabledModFilenames) || [];
    } catch { /* export without sources */ }
    const exported = { ...profile, nexusSources };
    const data = JSON.stringify(exported, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${profile.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast(t.toastProfileExported, 'success');
  }, [profiles, t, addToast]);
```

(The exported object is the profile plus `nexusSources`; no API key is present in `profile`, so none is exported.)

- [ ] **Step 2: Lint + commit**

Run: `npm run lint` (clean — `handleExportProfile` is already passed to ProfilesTab; making it async doesn't change the call site, which doesn't await it).

```bash
git add src/renderer/src/hooks/useProfileHandlers.js
git commit -m "feat: attach nexusSources to exported profiles"
```

---

## Task 5: ProfileImportModal + i18n

**Files:**
- Create: `src/renderer/src/components/modals/ProfileImportModal.jsx`
- Modify: `src/renderer/src/constants/i18n/{zh-TW,en,ja,ko,ru,de,fr}.js`

**Interfaces:**
- Produces: `<ProfileImportModal isOpen missing auto manual downloading progress onConfirm onClose t />`.
  - `auto`/`manual`: arrays of `{filename, modId?, fileId?, version?, displayName}`.
  - `progress`: `{ current, total, name } | null`. `onConfirm()`: start download. `onClose()`: dismiss.

- [ ] **Step 1: Add i18n keys (all 7 languages, after `toastProfileImportError`)**

In each `src/renderer/src/constants/i18n/<lang>.js`, find `"toastProfileImportError"` and insert after it. Values per language:

zh-TW:
```js
  "profileMissingTitle": "缺少模組",
  "profileMissingDesc": "這個配置需要 {n} 個你還沒安裝的模組。",
  "profileAutoSection": "可自動下載（{n}）",
  "profileManualSection": "需手動安裝（{n}）",
  "profileManualHint": "沒有 Nexus 來源或需手動取得，點名稱開啟 Nexus 頁面。",
  "profileDownloadBtn": "下載並套用",
  "profileApplyAnyway": "略過、直接套用",
  "profileDownloading": "下載中 {current}/{total}…",
  "profilePremiumHint": "自動下載需要 Nexus Premium，請到設定填 API Key。",
```
en:
```js
  "profileMissingTitle": "Missing Mods",
  "profileMissingDesc": "This profile needs {n} mods you don't have installed.",
  "profileAutoSection": "Auto-downloadable ({n})",
  "profileManualSection": "Manual install ({n})",
  "profileManualHint": "No Nexus source or must be fetched by hand — click a name to open its Nexus page.",
  "profileDownloadBtn": "Download & Apply",
  "profileApplyAnyway": "Skip & apply anyway",
  "profileDownloading": "Downloading {current}/{total}…",
  "profilePremiumHint": "Auto-download needs Nexus Premium — add your API key in Settings.",
```
ja:
```js
  "profileMissingTitle": "不足している Mod",
  "profileMissingDesc": "この構成には未インストールの Mod が {n} 個あります。",
  "profileAutoSection": "自動ダウンロード可 ({n})",
  "profileManualSection": "手動インストール ({n})",
  "profileManualHint": "Nexus ソースが無い、または手動取得が必要です。名前をクリックで Nexus ページを開きます。",
  "profileDownloadBtn": "ダウンロードして適用",
  "profileApplyAnyway": "スキップして適用",
  "profileDownloading": "ダウンロード中 {current}/{total}…",
  "profilePremiumHint": "自動ダウンロードには Nexus Premium が必要です。設定で API キーを入力してください。",
```
ko:
```js
  "profileMissingTitle": "누락된 모드",
  "profileMissingDesc": "이 프로필에는 설치되지 않은 모드가 {n}개 있습니다.",
  "profileAutoSection": "자동 다운로드 가능 ({n})",
  "profileManualSection": "수동 설치 ({n})",
  "profileManualHint": "Nexus 출처가 없거나 수동으로 받아야 합니다. 이름을 클릭하면 Nexus 페이지가 열립니다.",
  "profileDownloadBtn": "다운로드 후 적용",
  "profileApplyAnyway": "건너뛰고 적용",
  "profileDownloading": "다운로드 중 {current}/{total}…",
  "profilePremiumHint": "자동 다운로드는 Nexus Premium이 필요합니다. 설정에서 API 키를 입력하세요.",
```
ru:
```js
  "profileMissingTitle": "Отсутствующие моды",
  "profileMissingDesc": "Этому профилю нужно {n} модов, которых у вас нет.",
  "profileAutoSection": "Доступно автозагрузке ({n})",
  "profileManualSection": "Ручная установка ({n})",
  "profileManualHint": "Нет источника Nexus или нужно скачать вручную — нажмите имя, чтобы открыть страницу Nexus.",
  "profileDownloadBtn": "Скачать и применить",
  "profileApplyAnyway": "Пропустить и применить",
  "profileDownloading": "Загрузка {current}/{total}…",
  "profilePremiumHint": "Автозагрузка требует Nexus Premium — укажите API-ключ в настройках.",
```
de:
```js
  "profileMissingTitle": "Fehlende Mods",
  "profileMissingDesc": "Dieses Profil benötigt {n} Mods, die du nicht installiert hast.",
  "profileAutoSection": "Automatisch ladbar ({n})",
  "profileManualSection": "Manuelle Installation ({n})",
  "profileManualHint": "Keine Nexus-Quelle oder manuell zu beziehen – Namen anklicken, um die Nexus-Seite zu öffnen.",
  "profileDownloadBtn": "Herunterladen & anwenden",
  "profileApplyAnyway": "Überspringen & anwenden",
  "profileDownloading": "Lädt {current}/{total}…",
  "profilePremiumHint": "Auto-Download benötigt Nexus Premium – API-Key in den Einstellungen eintragen.",
```
fr:
```js
  "profileMissingTitle": "Mods manquants",
  "profileMissingDesc": "Ce profil nécessite {n} mods que vous n'avez pas installés.",
  "profileAutoSection": "Téléchargeables auto ({n})",
  "profileManualSection": "Installation manuelle ({n})",
  "profileManualHint": "Pas de source Nexus ou à récupérer manuellement — cliquez un nom pour ouvrir sa page Nexus.",
  "profileDownloadBtn": "Télécharger et appliquer",
  "profileApplyAnyway": "Ignorer et appliquer",
  "profileDownloading": "Téléchargement {current}/{total}…",
  "profilePremiumHint": "Le téléchargement auto nécessite Nexus Premium — ajoutez votre clé API dans les Réglages.",
```

- [ ] **Step 2: Run i18n completeness test**

Run: `npx vitest run tests/renderer/i18n-completeness.test.js`
Expected: PASS (all 7 languages gained the same keys).

- [ ] **Step 3: Create the modal**

Create `src/renderer/src/components/modals/ProfileImportModal.jsx` (structure/classes mirror `PreviewModal.jsx`):

```jsx
import { DownloadCloud, RefreshCw, X, ExternalLink, AlertTriangle } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';

const fmt = (s, vars) => (s || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

const ProfileImportModal = ({ isOpen, missing, auto, manual, downloading, progress, premium, onConfirm, onClose, t }) => {
  useEscapeKey(downloading ? () => {} : onClose, isOpen);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 [-webkit-app-region:no-drag]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-zoom-in" onClick={downloading ? undefined : onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="profile-import-title"
        className="relative w-full max-w-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] border border-white/60 dark:border-slate-700/50 overflow-hidden animate-modal-spring">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/50">
          <h3 id="profile-import-title" className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <DownloadCloud className="w-5 h-5" style={{ color: 'var(--accent-500)' }} />
            {t.profileMissingTitle}
          </h3>
          {!downloading && (
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{fmt(t.profileMissingDesc, { n: missing.length })}</p>

          {auto.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">{fmt(t.profileAutoSection, { n: auto.length })}</p>
              <div className="flex flex-col gap-1.5">
                {auto.map(s => (
                  <div key={s.filename} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-lg bg-slate-100/70 dark:bg-slate-800/60">
                    <DownloadCloud className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span className="truncate">{s.displayName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {manual.length > 0 && (
            <div className="mb-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">{fmt(t.profileManualSection, { n: manual.length })}</p>
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{t.profileManualHint}</p>
              <div className="flex flex-col gap-1.5">
                {manual.map(s => (
                  <button key={s.filename}
                    onClick={() => s.modId && window.open(`https://www.nexusmods.com/humanitz/mods/${s.modId}`)}
                    className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-slate-100/70 dark:bg-slate-800/60 text-left ${s.modId ? 'hover:bg-slate-200/70 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400 cursor-default'}`}>
                    <span className="truncate flex-1">{s.displayName}</span>
                    {s.modId ? <ExternalLink className="w-3.5 h-3.5 shrink-0" /> : null}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!premium && auto.length === 0 && manual.some(s => s.modId) && (
            <p className="text-[11px] text-slate-400 mt-3">{t.profilePremiumHint}</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200/60 dark:border-slate-700/50 flex items-center justify-end gap-2">
          {downloading ? (
            <span className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <RefreshCw className="w-4 h-4 animate-spin" style={{ color: 'var(--accent-500)' }} />
              {fmt(t.profileDownloading, { current: progress?.current ?? 0, total: progress?.total ?? auto.length })}
            </span>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm font-bold rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                {t.profileApplyAnyway}
              </button>
              {auto.length > 0 && (
                <button onClick={onConfirm} className="px-4 py-2 text-sm font-bold rounded-full text-white transition-all active:scale-95" style={{ backgroundColor: 'var(--accent-500)' }}>
                  {t.profileDownloadBtn}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfileImportModal;
```

- [ ] **Step 4: Lint + commit**

Run: `npm run lint` (clean).

```bash
git add src/renderer/src/components/modals/ProfileImportModal.jsx src/renderer/src/constants/i18n/
git commit -m "feat: add ProfileImportModal + i18n for missing-mod flow"
```

---

## Task 6: Apply-time detection + download wiring

**Files:**
- Modify: `src/renderer/src/hooks/useProfileHandlers.js` (`handleApplyProfile`, line 34-58; add modal state + download driver; export new state)
- Modify: `src/renderer/src/components/tabs/ProfilesTab.jsx` (render the modal)
- Modify: `src/renderer/src/App.jsx` (pass modal props through if ProfilesTab needs them — verify in step)

**Interfaces:**
- Consumes: `classifyProfileMods` (Task 3), `window.api.nexus.validate()`, `window.api.nexus.installFile(modId, fileId, version, true)` (Task 2), `ProfileImportModal` (Task 5).

- [ ] **Step 1: Add detection + download driver to the hook**

In `src/renderer/src/hooks/useProfileHandlers.js`:

(a) Add the import at the top, after line 2:
```js
import { classifyProfileMods } from './profile-nexus-utils.js';
```

(b) Add modal state near the other `useState`s (after line 8):
```js
  const [importModal, setImportModal] = useState(null); // { profileId, missing, auto, manual, premium } | null
  const [importDownloading, setImportDownloading] = useState(false);
  const [importProgress, setImportProgress] = useState(null); // { current, total, name }
```

(c) Refactor `handleApplyProfile` (line 34-58). Split the existing toggle/restore body into a reusable `applyProfileNow`, and gate it behind missing-mod detection:

```js
  const applyProfileNow = useCallback(async (profile) => {
    const profileSet = normalizeProfileFilenames(profile.enabledModFilenames);
    for (const mod of modules) {
      const shouldBeEnabled = modIsInProfile(profileSet, mod);
      if (mod.enabled !== shouldBeEnabled) {
        await window.api.mods.toggle(mod.filename);
      }
    }
    try {
      if (profile.configSnapshot && window.api?.mods?.restoreConfigs) {
        await window.api.mods.restoreConfigs(profile.configSnapshot);
      }
    } catch { /* ignore */ }
    await refreshMods();
    setActiveProfileId(profile.id);
    persistSetting('activeProfileId', profile.id);
    addToast(t.toastProfileApplied, 'success');
  }, [modules, refreshMods, persistSetting, t, addToast]);

  const handleApplyProfile = useCallback(async (profileId) => {
    if (!window.api || applyingProfileId) return;
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;

    // Detect mods the profile wants that aren't installed here.
    let premium = false;
    try { premium = (await window.api?.nexus?.validate?.())?.ok === true; } catch { /* offline */ }
    const { missing, auto, manual } = classifyProfileMods(profile, modules, premium);

    if (missing.length > 0) {
      // Surface the modal; actual apply happens after the user chooses.
      setImportModal({ profileId, missing, auto, manual, premium });
      return;
    }
    setApplyingProfileId(profileId);
    try { await applyProfileNow(profile); } finally { setApplyingProfileId(null); }
  }, [applyingProfileId, profiles, modules, applyProfileNow]);

  // Modal actions:
  const importDownloadAndApply = useCallback(async () => {
    const m = importModal;
    if (!m) return;
    const profile = profiles.find(p => p.id === m.profileId);
    if (!profile) { setImportModal(null); return; }
    setImportDownloading(true);
    try {
      let i = 0;
      for (const s of m.auto) {
        i += 1;
        setImportProgress({ current: i, total: m.auto.length, name: s.displayName });
        try {
          await window.api.nexus.installFile(s.modId, s.fileId, s.version || undefined, true);
        } catch { /* leave it for manual; continue the rest */ }
      }
      await refreshMods();
      await applyProfileNow(profile);
    } finally {
      setImportDownloading(false);
      setImportProgress(null);
      setImportModal(null);
    }
  }, [importModal, profiles, refreshMods, applyProfileNow]);

  const importApplyAnyway = useCallback(async () => {
    const m = importModal;
    setImportModal(null);
    if (!m) return;
    const profile = profiles.find(p => p.id === m.profileId);
    if (profile) await applyProfileNow(profile);
  }, [importModal, profiles, applyProfileNow]);

  const closeImportModal = useCallback(() => { if (!importDownloading) setImportModal(null); }, [importDownloading]);
```

(d) Extend the returned object (line 122-128) to include the modal state/actions:
```js
    handleExportProfile, handleImportProfile,
    importModal, importDownloading, importProgress,
    importDownloadAndApply, importApplyAnyway, closeImportModal,
    initProfiles,
```

- [ ] **Step 2: Render the modal**

Find where `useProfileHandlers`'s return is destructured (App.jsx) and where `ProfilesTab` is rendered. The simplest seam: render `ProfileImportModal` inside `ProfilesTab` (it already receives the profile handlers). In `ProfilesTab.jsx`:

- Add to imports (top): `import ProfileImportModal from '../modals/ProfileImportModal';`
- Add the new props to the component's destructured props (alongside `handleApplyProfile`, `applyingProfileId`): `importModal, importDownloading, importProgress, importDownloadAndApply, importApplyAnyway, closeImportModal,`
- Before the component's closing `</…>`/return end, render:
```jsx
      <ProfileImportModal
        isOpen={!!importModal}
        missing={importModal?.missing || []}
        auto={importModal?.auto || []}
        manual={importModal?.manual || []}
        premium={!!importModal?.premium}
        downloading={importDownloading}
        progress={importProgress}
        onConfirm={importDownloadAndApply}
        onClose={importApplyAnyway}
        t={t}
      />
```

- In `App.jsx`, where `ProfilesTab` is rendered (~line 437), thread the new props from the `useProfileHandlers` destructure (App.jsx ~line 210+) into the `<ProfilesTab ... />` call. Verify the destructure includes the new names and add them to the JSX props.

- [ ] **Step 3: Lint + full suite**

Run: `npm run lint` (clean) and `npm test` (all pass — no existing test exercises these components; back-compat path: a profile with no missing mods applies exactly as before).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/hooks/useProfileHandlers.js src/renderer/src/components/tabs/ProfilesTab.jsx src/renderer/src/App.jsx
git commit -m "feat: auto-download missing Nexus mods on profile apply"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full lint** — `npm run lint` → exit 0.
- [ ] **Step 2: Full suite** — `npm test` → all pass, including `nexus-source-match`, `profile-nexus-utils`, `i18n-completeness`.
- [ ] **Step 3: Security check** — confirm no API key leaks into export: `grep -n "apiKey\|nexusApiKey" src/renderer/src/hooks/useProfileHandlers.js` should show no key written into the exported object (only `profile` + `nexusSources`).
- [ ] **Step 4: Back-compat check** — re-read `handleApplyProfile`: a profile with `missing.length === 0` (everything installed, or old profile with no sources where everything is present) must call `applyProfileNow` directly with no modal.

---

## Self-Review

- **Spec coverage:** §1 format (`nexusSources` shape, key never exported, back-compat) → Tasks 4/6 + Global Constraints; §2 export reverse-lookup → Task 1 + Task 4; §3 apply detection + modal → Tasks 3/5/6; §4 fileId fallback → Task 2; §5 file/scope → all tasks match the table; §6 error handling (no premium → manual, delist → fallback, single failure → continue, old profile unchanged) → Task 6 (try/catch per download, `applyProfileNow` gate) + Task 2; §7 tests → Tasks 1/3 + Task 7. All covered.
- **Placeholder scan:** none — every code step ships full content. (Task 6 Step 2 asks the implementer to *verify* the App.jsx prop seam rather than guessing line numbers, which is a real instruction, not a placeholder.)
- **Type consistency:** `matchSourcesToMods` → `{filename, modId, fileId, version, displayName}` (Task 1) = `nexusSources` entry consumed by `classifyProfileMods` (Task 3) and rendered by `ProfileImportModal` (Task 5). `installFile(modId, fileId, version, fallbackToLatest)` (Task 2) called with `true` in Task 6. `importModal/importDownloading/importProgress` produced in Task 6 hook, consumed by Task 5 modal props. Consistent.
