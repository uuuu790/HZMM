# C++ Mod Subcategory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the module library's UE4SS section into separate Lua and C++ subgroups so users can tell scripted mods from compiled cppmods at a glance.

**Architecture:** Backend tags each UE4SS mod with a new `subtype: 'lua' | 'cpp'` field (the `type` field stays `'UE4SS'` — C++ is a *subtype* of UE4SS, not a parallel category). The frontend renders three parallel collapsible blocks — PAK / UE4SS·Lua / UE4SS·C++ — by passing a `subtype` filter to the existing `ModuleList` component. Fully backward compatible: PAK mods carry no `subtype`, and nothing breaks if `subtype` is absent.

**Tech Stack:** Electron + React 18 + Vite + Tailwind; Vitest (happy-dom, mock-fs) for tests; lucide-react icons.

## Global Constraints

- Do NOT change existing `type` values. `type` stays `'PAK' | 'UE4SS'`; C++ is expressed via the new `subtype` field only.
- Backward compatible: PAK mods have no `subtype`; UE4SS classification logic must not alter `enabled`, `hybrid`, `linkedPaks`, or any existing field.
- **Lua-priority rule:** a folder with BOTH a Lua entry (`Scripts/main.lua` or `main.lua`) AND a DLL classifies as `'lua'` (DLL treated as an auxiliary resource).
- i18n: all 7 languages (`zh-TW, en, ja, ko, ru, de, fr`) must stay in sync — `tests/renderer/i18n-completeness.test.js` fails on any missing/extra/empty key (reference language is `zh-TW`).
- Out of scope (do NOT touch): `DashboardTab.jsx` stats and `ProfilesTab.jsx` export stay at the PAK / UE4SS level — no Lua/C++ split there.
- Commit style: Conventional Commits (`feat:`, `test:`, `chore:`…).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/main/ipc/mods-scan.js` | Mod scanning & classification | Add `classifyUe4ssMod()` + set `subtype` on UE4SS mods |
| `tests/ipc/mods-scan.test.js` | Backend classification tests | Add `classifyUe4ssMod` describe block |
| `src/renderer/src/constants/modIcons.js` | Mod icon/color mapping | Add `CPP` entry + `getModIcon` cpp branch |
| `tests/renderer/modIcons.test.js` | Icon mapping tests | **New** |
| `src/renderer/src/constants/i18n/*.js` (×7) | UI strings | Add `ue4ssLuaTitle` / `ue4ssCppTitle` |
| `src/renderer/src/components/common/ModuleList.jsx` | One collapsible mod block | Add `subtype` prop to filter |
| `src/renderer/src/components/tabs/ModulesTab.jsx` | Filter bar + block layout | `C++` filter, processed-modules filter, 3-block render |

---

## Task 1: Backend — `classifyUe4ssMod` + `subtype` field

**Files:**
- Modify: `src/main/ipc/mods-scan.js` (add function near `isUe4ssMod` at line 32-43; set `subtype` in the UE4SS push at line 134-145)
- Test: `tests/ipc/mods-scan.test.js`

**Interfaces:**
- Produces: `classifyUe4ssMod(modDir: string): 'lua' | 'cpp'` (exported). Every UE4SS mod object gains `subtype: 'lua' | 'cpp'`. PAK mod objects are unchanged.

- [ ] **Step 1: Write the failing test**

Append to `tests/ipc/mods-scan.test.js` (after the existing `isUe4ssMod` describe block, before the final `})` of the file — and add `classifyUe4ssMod` to the import on line 5: `import { isUe4ssMod, classifyUe4ssMod } from '../../src/main/ipc/mods-scan.js'`):

```js
describe('classifyUe4ssMod', () => {
  it('classifies a Scripts/main.lua mod as lua', () => {
    const modDir = makeMod({ 'Scripts/main.lua': '-- entry' })
    expect(classifyUe4ssMod(modDir)).toBe('lua')
  })

  it('classifies a flat main.lua mod as lua', () => {
    const modDir = makeMod({ 'main.lua': '-- flat' })
    expect(classifyUe4ssMod(modDir)).toBe('lua')
  })

  it('classifies a dlls/main.dll cppmod as cpp', () => {
    const modDir = makeMod({ 'dlls/main.dll': 'binary', 'enabled.txt': '' })
    expect(classifyUe4ssMod(modDir)).toBe('cpp')
  })

  it('classifies a first-level .dll (unusual layout) as cpp', () => {
    const modDir = makeMod({ 'rogue.dll': 'binary' })
    expect(classifyUe4ssMod(modDir)).toBe('cpp')
  })

  it('prefers lua when a mod has BOTH a lua entry and a dll', () => {
    const modDir = makeMod({ 'Scripts/main.lua': '-- lua', 'dlls/main.dll': 'binary' })
    expect(classifyUe4ssMod(modDir)).toBe('lua')
  })

  it('defaults to lua for a directory with no recognizable markers', () => {
    const modDir = makeMod({ 'README.md': '# nothing' })
    expect(classifyUe4ssMod(modDir)).toBe('lua')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ipc/mods-scan.test.js`
Expected: FAIL — `classifyUe4ssMod is not a function` (import is undefined).

- [ ] **Step 3: Add the `classifyUe4ssMod` function**

In `src/main/ipc/mods-scan.js`, immediately after the `isUe4ssMod` function (after line 43), add:

```js
// Classify a recognized UE4SS mod into its subtype for UI grouping.
// Lua-priority: if a Lua entry exists, it's a Lua mod even when a DLL is also
// present (the DLL is treated as an auxiliary resource). Only when there's no
// Lua entry do we look at dlls/main.dll or any first-level *.dll → cpp.
// Mirrors isUe4ssMod's detection signals so the two never disagree.
export function classifyUe4ssMod(modDir) {
  const hasScripts = fs.existsSync(path.join(modDir, 'Scripts', 'main.lua'))
  const hasMainLua = fs.existsSync(path.join(modDir, 'main.lua'))
  if (hasScripts || hasMainLua) return 'lua'
  const hasCppMod = fs.existsSync(path.join(modDir, 'dlls', 'main.dll'))
  if (hasCppMod) return 'cpp'
  try {
    if (fs.readdirSync(modDir).some(f => f.endsWith('.dll'))) return 'cpp'
  } catch { /* unreadable dir — fall through to default */ }
  return 'lua' // defensive default; isUe4ssMod already gated this is a UE4SS mod
}
```

- [ ] **Step 4: Set `subtype` on the UE4SS mod object**

In `src/main/ipc/mods-scan.js`, in the `mods.push({ ... })` for UE4SS mods (line 134-145), add the `subtype` field right after `type: 'UE4SS',`:

```js
        type: 'UE4SS',
        subtype: classifyUe4ssMod(modDir),
        hybrid: isHybrid,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/ipc/mods-scan.test.js`
Expected: PASS — all `isUe4ssMod` and `classifyUe4ssMod` tests green.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/mods-scan.js tests/ipc/mods-scan.test.js
git commit -m "feat: classify UE4SS mods as lua/cpp subtype in scan"
```

---

## Task 2: Frontend — `modIcons` CPP entry

**Files:**
- Modify: `src/renderer/src/constants/modIcons.js`
- Test: `tests/renderer/modIcons.test.js` (create)

**Interfaces:**
- Consumes: mod objects with `{ type, subtype }` from Task 1.
- Produces: `MOD_ICONS.CPP` (amber + `Binary` icon); `getModIcon(mod)` returns `MOD_ICONS.CPP` when `mod.type === 'UE4SS' && mod.subtype === 'cpp'`, else existing behavior.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/modIcons.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { MOD_ICONS, getModIcon } from '../../src/renderer/src/constants/modIcons.js'

describe('getModIcon', () => {
  it('returns the PAK icon for a PAK mod', () => {
    expect(getModIcon({ type: 'PAK' })).toBe(MOD_ICONS.PAK)
  })

  it('returns the UE4SS icon for a lua-subtype UE4SS mod', () => {
    expect(getModIcon({ type: 'UE4SS', subtype: 'lua' })).toBe(MOD_ICONS.UE4SS)
  })

  it('returns the UE4SS icon for a UE4SS mod with no subtype (back-compat)', () => {
    expect(getModIcon({ type: 'UE4SS' })).toBe(MOD_ICONS.UE4SS)
  })

  it('returns the CPP icon for a cpp-subtype UE4SS mod', () => {
    expect(getModIcon({ type: 'UE4SS', subtype: 'cpp' })).toBe(MOD_ICONS.CPP)
  })

  it('CPP icon uses an amber accent distinct from PAK/UE4SS', () => {
    expect(MOD_ICONS.CPP.iconColor).toBe('text-amber-500')
    expect(MOD_ICONS.CPP.icon).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/modIcons.test.js`
Expected: FAIL — `MOD_ICONS.CPP` is undefined / `getModIcon` returns UE4SS for cpp.

- [ ] **Step 3: Implement the CPP entry and getModIcon branch**

Replace the entire contents of `src/renderer/src/constants/modIcons.js` with:

```js
import { Package, Puzzle, Binary } from 'lucide-react';

export const MOD_ICONS = {
  PAK: { icon: Package, color: 'from-indigo-500/20 to-blue-500/20', accent: 'text-indigo-500', iconColor: 'text-indigo-500' },
  UE4SS: { icon: Puzzle, color: 'from-emerald-500/20 to-green-500/20', accent: 'text-emerald-500', iconColor: 'text-emerald-500' },
  CPP: { icon: Binary, color: 'from-amber-500/20 to-orange-500/20', accent: 'text-amber-500', iconColor: 'text-amber-500' },
  default: { icon: Package, color: 'from-slate-500/20 to-slate-600/20', accent: 'text-slate-500', iconColor: 'text-slate-500' }
};

export function getModIcon(mod) {
  if (mod.type === 'UE4SS' && mod.subtype === 'cpp') return MOD_ICONS.CPP;
  return MOD_ICONS[mod.type] || MOD_ICONS.default;
}

export function cleanModName(name) {
  return name.replace(/\.(pak|zip|rar)(\.disabled)?$/i, '').replace(/_P$/, '').replace(/\s+P$/, '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/modIcons.test.js`
Expected: PASS — all 5 assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/constants/modIcons.js tests/renderer/modIcons.test.js
git commit -m "feat: add amber Binary icon for UE4SS C++ mods"
```

---

## Task 3: i18n — Lua / C++ subgroup titles (7 languages)

**Files:**
- Modify: `src/renderer/src/constants/i18n/{zh-TW,en,ja,ko,ru,de,fr}.js`
- Test: `tests/renderer/i18n-completeness.test.js` (existing — run, don't edit)

**Interfaces:**
- Produces: `t.ue4ssLuaTitle` and `t.ue4ssCppTitle` in all 7 language objects (consumed by Task 4).

**Note:** `UE4SS`, `Lua`, `C++` are proper nouns and the `·` separator is language-neutral, so the value is identical across all languages. Each file already has `ue4ssTitle` on line 16 — insert the two new keys directly after it.

- [ ] **Step 1: Add both keys after `ue4ssTitle` (line 16) in each of the 7 files**

In EACH file `src/renderer/src/constants/i18n/zh-TW.js`, `en.js`, `ja.js`, `ko.js`, `ru.js`, `de.js`, `fr.js`, find the line:

```js
  "ue4ssTitle": "...",
```

and insert immediately after it:

```js
  "ue4ssLuaTitle": "UE4SS · Lua",
  "ue4ssCppTitle": "UE4SS · C++",
```

(Same two lines verbatim in all 7 files.)

- [ ] **Step 2: Run the i18n completeness test**

Run: `npx vitest run tests/renderer/i18n-completeness.test.js`
Expected: PASS — no missing/extra/empty keys across all 7 languages (each gained the same 2 keys).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/constants/i18n/
git commit -m "feat: add UE4SS Lua/C++ subgroup titles to i18n"
```

---

## Task 4: Frontend UI — `ModuleList` subtype + `ModulesTab` 3-block layout

**Files:**
- Modify: `src/renderer/src/components/common/ModuleList.jsx` (line 74 signature, line 78 filter)
- Modify: `src/renderer/src/components/tabs/ModulesTab.jsx` (line 3 import, line 90-106 processedModules, line 160 filter array, line 268-343 render)

**Interfaces:**
- Consumes: `subtype` field (Task 1), `MOD_ICONS.CPP`/`getModIcon` (Task 2), `t.ue4ssLuaTitle`/`t.ue4ssCppTitle` (Task 3).

- [ ] **Step 1: Add `subtype` prop to ModuleList**

In `src/renderer/src/components/common/ModuleList.jsx`, line 74, add `subtype` to the destructured props (right after `type,`):

```jsx
const ModuleList = ({ modules, type, subtype, title, icon: Icon, colorClass, activeModuleId, onModuleClick, onToggle, onUninstallLocal, onOpenConfig, onRenameMod, t, lang, newlyInstalledMods, selectedMods, onToggleSelect, onRangeSelect, conflictModSet, modUpdateMap, updatingModId, onUpdateMod, nexusApiKey }) => {
```

Then change the filter on line 78 from:

```jsx
  const filteredModules = modules.filter(m => m.type === type);
```

to:

```jsx
  const filteredModules = modules.filter(m => m.type === type && (!subtype || m.subtype === subtype));
```

- [ ] **Step 2: Import `Binary` in ModulesTab**

In `src/renderer/src/components/tabs/ModulesTab.jsx`, line 3, add `Binary` to the lucide-react import:

```jsx
import { Package, Puzzle, Search, X, Power, Trash2, ChevronDown, RefreshCw, Binary } from 'lucide-react';
```

- [ ] **Step 3: Handle the `C++` filter in processedModules**

In `ModulesTab.jsx`, replace line 92:

```jsx
    if (filterType !== 'all') result = result.filter(m => m.type === filterType)
```

with:

```jsx
    if (filterType === 'C++') result = result.filter(m => m.type === 'UE4SS' && m.subtype === 'cpp')
    else if (filterType !== 'all') result = result.filter(m => m.type === filterType)
```

- [ ] **Step 4: Add the `C++` filter pill**

In `ModulesTab.jsx`, line 160, change the filter array:

```jsx
                  {['all', 'PAK', 'UE4SS'].map(type => (
```

to:

```jsx
                  {['all', 'PAK', 'UE4SS', 'C++'].map(type => (
```

(The button label uses `{type === 'all' ? t.filterAll : type}`, so `'C++'` renders literally — no i18n key needed, matching how `PAK`/`UE4SS` render.)

- [ ] **Step 5: Replace the module-list render block with the 3-block layout**

In `ModulesTab.jsx`, replace the entire render block (lines 268-343, the `{filterType === 'all' ? ( ... ) : ( ... )}` expression) with:

```jsx
          {/* Module lists — PAK / UE4SS·Lua / UE4SS·C++ as parallel blocks.
              commonListProps dedupes the long prop list across all three. Each
              ModuleList returns null when its (type, subtype) slice is empty,
              so empty subgroups simply don't render. */}
          {(() => {
            const commonListProps = {
              activeModuleId,
              onModuleClick: handleModuleClick,
              onToggle: handleToggleEnable,
              onUninstallLocal: handleUninstallLocalMod,
              onOpenConfig: setConfigEditorMod,
              onRenameMod: handleRenameMod,
              t, lang,
              newlyInstalledMods,
              selectedMods,
              onToggleSelect: handleToggleSelect,
              onRangeSelect: handleRangeSelect,
              conflictModSet,
              modUpdateMap,
              updatingModId,
              onUpdateMod,
              nexusApiKey,
            };
            return (
              <>
                {(filterType === 'all' || filterType === 'PAK') && (
                  <ModuleList
                    modules={processedModules}
                    type="PAK"
                    title={t.pakTitle}
                    icon={Package}
                    colorClass="text-indigo-600 dark:text-indigo-400"
                    {...commonListProps}
                  />
                )}
                {(filterType === 'all' || filterType === 'UE4SS') && (
                  <ModuleList
                    modules={processedModules}
                    type="UE4SS"
                    subtype="lua"
                    title={t.ue4ssLuaTitle || 'UE4SS · Lua'}
                    icon={Puzzle}
                    colorClass="text-emerald-600 dark:text-emerald-400"
                    {...commonListProps}
                  />
                )}
                {(filterType === 'all' || filterType === 'UE4SS' || filterType === 'C++') && (
                  <ModuleList
                    modules={processedModules}
                    type="UE4SS"
                    subtype="cpp"
                    title={t.ue4ssCppTitle || 'UE4SS · C++'}
                    icon={Binary}
                    colorClass="text-amber-600 dark:text-amber-400"
                    {...commonListProps}
                  />
                )}
              </>
            );
          })()}
```

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no errors. (If lint flags an unused var, confirm `Binary` is used and `subtype` is consumed.)

- [ ] **Step 7: Manual verification in dev**

Run: `npm run dev`. In the Modules tab confirm:
1. With UE4SS mods of both kinds installed, "全部" view shows three blocks: PAK / UE4SS · Lua / UE4SS · C++.
2. The UE4SS · C++ block uses the amber `Binary` icon; cpp mod cards also show the amber icon.
3. Filter pills now include `C++`; clicking it shows only cpp mods; clicking `UE4SS` shows both Lua and C++ blocks; `PAK` shows only PAK.
4. A folder containing only `dlls/main.dll` appears under C++; a `Scripts/main.lua` mod appears under Lua.
5. Enable/disable toggle and rename still work in all blocks.

If no cpp mod is installed to test with, create one: `UE4SS/Mods/_TestCpp/dlls/main.dll` (any bytes) + `UE4SS/Mods/_TestCpp/enabled.txt` (empty), then Rescan. Delete it afterward.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/common/ModuleList.jsx src/renderer/src/components/tabs/ModulesTab.jsx
git commit -m "feat: split module library UE4SS into Lua/C++ blocks"
```

---

## Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full lint**

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all suites pass — including `mods-scan`, `modIcons`, and `i18n-completeness`.

- [ ] **Step 3: Confirm out-of-scope areas untouched**

Run: `git diff --name-only origin/master...HEAD`
Expected: the only changed source files are `mods-scan.js`, `modIcons.js`, the 7 i18n files, `ModuleList.jsx`, `ModulesTab.jsx`, plus the two test files and these docs. `DashboardTab.jsx` and `ProfilesTab.jsx` must NOT appear.

---

## Self-Review

- **Spec coverage:** §1 classification → Task 1; §2 `subtype` data structure → Task 1; §3 backend (`mods-scan.js` only) → Task 1; §4.1 amber+Binary icon → Task 2; §4.2 filter bar + 3 blocks → Task 4; §4.3 `ModuleList` subtype prop → Task 4 Step 1; §4.4 i18n → Task 3; §5 out-of-scope (Dashboard/Profiles untouched) → Task 5 Step 3 guard; §6 tests → Task 1 (4+ classification cases) & Task 4 Step 7 (frontend manual). All covered.
- **Placeholder scan:** none — every code step has full, copy-pasteable content.
- **Type consistency:** `classifyUe4ssMod` (Task 1) → `subtype` field (Task 1) → `getModIcon` cpp branch (Task 2) → `subtype` prop + `m.subtype === 'cpp'` filter (Task 4). `t.ue4ssLuaTitle`/`t.ue4ssCppTitle` defined in Task 3, consumed in Task 4. Names consistent throughout.
