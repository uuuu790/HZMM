# Nexus 詳細頁重新設計 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉 NexusModDetailModal 的圖片模糊、BBCode 清單 `[/*]` 殘留、中文 U+FFFD 亂碼三個 bug，並把版面重排成 Nexus 風格（大 banner、統計列、描述/檔案分頁）。

**Architecture:** 兩個後端純邏輯修復（V2 GraphQL 的 UTF-8 解碼、BBCode 清單轉換）走 TDD；一個圖片來源 adapter 抽成可測純函式；最後一個 task 是 modal 版面重排（無 component harness，dev 手動驗證）。各 task 獨立可測、可 review。

**Tech Stack:** Electron main（`https` + GraphQL）、React 18 renderer、Vitest（`node` 預設環境；`bbcode` 與 DOM 相關用 `happy-dom`）。

## Global Constraints

- **不做**：圖庫輪播、posts/bugs/留言、追蹤/讚等寫入動作（V2 API 無此資料）。
- **向後相容**：`adaptV2Mod` 的 V1 snake_case fallback 欄位維持；無圖模組以漸層 fallback；V2 解碼修復不改 GraphQL 回傳形狀。
- **安全**：`bbcodeToHtml` 的 DOMPurify sanitize 管道不動；清單修復只改標籤轉換。
- **主題色**：modal 一律用 runtime 主題變數（`var(--accent-500)`、`rgba(var(--accent-rgb), …)`），不寫死顏色。
- Commit style：Conventional Commits。

---

## File Structure

| 檔案 | 職責 | 變更 |
|---|---|---|
| `src/main/ipc/nexus-v2-client.js` | V2 GraphQL client | `gqlRequest` 改正確 UTF-8 解碼；export `decodeUtf8Chunks` |
| `src/renderer/src/utils/bbcode.js` | BBCode → 安全 HTML | 清單處理修 `[/*]` + 裸 `[*]` |
| `src/renderer/src/utils/nexus-mod-adapt.js` | **新** V2→render 欄位 adapter | 由 modal 抽出 `adaptV2Mod`，圖片優先 `pictureUrl` |
| `src/renderer/src/components/modals/NexusModDetailModal.jsx` | 詳細頁 modal | import adapter；版面重排（banner/統計列/分頁） |
| `src/renderer/src/index.css` | `.nexus-description` 樣式 | 視需要微調清單/間距 |
| `tests/ipc/nexus-v2-decode.test.js` | **新** | 跨 chunk 解碼測試 |
| `tests/renderer/bbcode.test.js` | 既有，擴充 | 清單 `[/*]`/裸 `[*]` 測試 |
| `tests/renderer/nexus-mod-adapt.test.js` | **新** | 圖片來源優先序測試 |

---

## Task 1: V2 GraphQL UTF-8 解碼修復

**Files:**
- Modify: `src/main/ipc/nexus-v2-client.js`（`gqlRequest` 約 line 49-90；新增 export `decodeUtf8Chunks`）
- Test: `tests/ipc/nexus-v2-decode.test.js`（新建）

**Interfaces:**
- Produces: `export function decodeUtf8Chunks(chunks: Buffer[]): string`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/ipc/nexus-v2-decode.test.js`：

```js
import { describe, it, expect } from 'vitest'
import { decodeUtf8Chunks } from '../../src/main/ipc/nexus-v2-client.js'

describe('decodeUtf8Chunks', () => {
  it('reassembles a multi-byte char split across chunks', () => {
    // "中文" is 6 UTF-8 bytes; cut at byte 4 splits "文" (bytes 3-5) in half.
    const full = Buffer.from('中文', 'utf8')
    const a = full.subarray(0, 4)
    const b = full.subarray(4)
    expect(decodeUtf8Chunks([a, b])).toBe('中文')
  })

  it('the old string-concat approach corrupts the same input (regression guard)', () => {
    const full = Buffer.from('完整繁體中文翻譯', 'utf8')
    const a = full.subarray(0, 22)
    const b = full.subarray(22)
    // '' + Buffer decodes each chunk independently -> U+FFFD at the boundary.
    const broken = '' + a + b
    expect(broken).toContain('�')
    expect(decodeUtf8Chunks([a, b])).toBe('完整繁體中文翻譯')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/ipc/nexus-v2-decode.test.js`
Expected: FAIL — `decodeUtf8Chunks is not a function` (尚未 export)。

- [ ] **Step 3: 實作 helper + 改 gqlRequest**

在 `nexus-v2-client.js` 新增 export（放在 `gqlRequest` 上方）：

```js
// Concatenate raw response chunks THEN decode once. Decoding each chunk
// independently (the old `data += chunk` form) mangles any multi-byte UTF-8
// character that straddles a TCP chunk boundary into U+FFFD.
export function decodeUtf8Chunks(chunks) {
  return Buffer.concat(chunks).toString('utf8')
}
```

把 `gqlRequest` 內的回應收集（原 `let data = ''` / `res.on('data', c => { data += c })`）改成：

```js
    }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const data = decodeUtf8Chunks(chunks)
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`V2 HTTP ${res.statusCode}: ${data.slice(0, 200)}`))
        }
        try {
          const parsed = JSON.parse(data)
          if (parsed.errors) {
            return reject(new Error(`V2 GraphQL: ${parsed.errors[0]?.message || 'unknown'}`))
          }
          resolve(parsed.data)
        } catch (e) {
          reject(new Error(`V2 parse error: ${e.message}`))
        }
      })
    })
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/ipc/nexus-v2-decode.test.js`
Expected: PASS（2 個）。

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/nexus-v2-client.js tests/ipc/nexus-v2-decode.test.js
git commit -m "fix: decode V2 GraphQL response after concatenating chunks"
```

---

## Task 2: BBCode 清單 `[/*]` / 裸 `[*]` 修復

**Files:**
- Modify: `src/renderer/src/utils/bbcode.js`（`bbcodeToRawHtml` 清單區，約 line 169-176）
- Test: `tests/renderer/bbcode.test.js`（既有，擴充 line 167 的 list `it`）

**Interfaces:**
- Consumes: `_testInternals.bbcodeToRawHtml(input: string): string`（既有）

- [ ] **Step 1: 寫失敗測試**

在 `tests/renderer/bbcode.test.js` 既有的 `renders unordered and ordered lists`（line 167）測試**之後**，新增：

```js
  it('handles [*]item[/*] paired closers and bare [*] without [list]', () => {
    // Paired [/*] closer must not survive inside [list].
    expect(bbcodeToRawHtml('[list][*]one[/*][*]two[/*][/list]'))
      .toContain('<ul><li>one</li><li>two</li></ul>')
    expect(bbcodeToRawHtml('[list=1][*]one[/*][*]two[/*][/list]'))
      .toContain('<ol><li>one</li><li>two</li></ol>')
    // Bare [*] with no [list] wrapper still becomes a <ul>.
    expect(bbcodeToRawHtml('[*]one[/*][*]two[/*]'))
      .toContain('<ul><li>one</li><li>two</li></ul>')
    // No [/*] residue anywhere.
    expect(bbcodeToRawHtml('[list][*]a[/*][/list]')).not.toContain('[/*]')
    expect(bbcodeToRawHtml('[*]a[/*]')).not.toContain('[/*]')
  })
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/renderer/bbcode.test.js`
Expected: FAIL — `[/*]` 殘留在輸出、裸 `[*]` 未被包成 `<ul>`。

- [ ] **Step 3: 實作清單修復**

在 `bbcode.js` `bbcodeToRawHtml` 中，把現有的兩條 list 規則（`[list=1]` 與 `[list]`，約 line 169-176）整段**替換**為：

```js
    // Strip redundant [/*] item closers. Some authors pair [*]item[/*]; once
    // [*] delimits items the closer is noise — and it was leaking into output.
    s = s.replace(/\[\/\*\]/gi, '')

    s = s.replace(/\[list=1\]([\s\S]*?)\[\/list\]/gi, (_m, body) => {
      const items = body.split(/\[\*\]/).map(x => x.trim()).filter(Boolean)
      return `<ol>${items.map(i => `<li>${i}</li>`).join('')}</ol>`
    })
    s = s.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, (_m, body) => {
      const items = body.split(/\[\*\]/).map(x => x.trim()).filter(Boolean)
      return `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`
    })

    // Bare [*] items the author wrote without a [list] wrapper. Grab a run of
    // consecutive [*]-led segments (each segment runs to the next [*]) and wrap
    // it in one <ul>. `[^\[]|\[(?!\*\])` lets item text keep already-converted
    // HTML and stray `[` that aren't list markers.
    s = s.replace(/\[\*\](?:[^\[]|\[(?!\*\]))*(?:\[\*\](?:[^\[]|\[(?!\*\]))*)*/g, (run) => {
      const items = run.split(/\[\*\]/).map(x => x.trim()).filter(Boolean)
      return items.length ? `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>` : run
    })
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/renderer/bbcode.test.js`
Expected: PASS（既有 56 案例 + 新案例全綠）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/utils/bbcode.js tests/renderer/bbcode.test.js
git commit -m "fix: handle [/*] closers and bare [*] items in bbcode lists"
```

---

## Task 3: 抽出圖片 adapter + 全解析度圖片

**Files:**
- Create: `src/renderer/src/utils/nexus-mod-adapt.js`
- Modify: `src/renderer/src/components/modals/NexusModDetailModal.jsx`（移除本地 `adaptV2Mod` 約 line 42-56，改 import）
- Test: `tests/renderer/nexus-mod-adapt.test.js`（新建）

**Interfaces:**
- Produces: `export function adaptV2Mod(v2: object|null): object|null` — 與原本相同欄位，差別只在 `picture_url` 優先序。

- [ ] **Step 1: 寫失敗測試**

建立 `tests/renderer/nexus-mod-adapt.test.js`：

```js
import { describe, it, expect } from 'vitest'
import { adaptV2Mod } from '../../src/renderer/src/utils/nexus-mod-adapt.js'

describe('adaptV2Mod', () => {
  it('prefers full-resolution pictureUrl over thumbnails', () => {
    const out = adaptV2Mod({
      modId: 7, pictureUrl: 'full.jpg',
      thumbnailLargeUrl: 'thumbL.jpg', thumbnailUrl: 'thumbS.jpg',
    })
    expect(out.picture_url).toBe('full.jpg')
  })
  it('falls back to thumbnails when pictureUrl is absent', () => {
    expect(adaptV2Mod({ modId: 7, thumbnailLargeUrl: 'thumbL.jpg' }).picture_url).toBe('thumbL.jpg')
    expect(adaptV2Mod({ modId: 7, thumbnailUrl: 'thumbS.jpg' }).picture_url).toBe('thumbS.jpg')
  })
  it('maps V2 camelCase to the render snake_case shape', () => {
    const out = adaptV2Mod({ modId: 7, downloads: 10, endorsements: 3, updatedAt: 't', author: 'A' })
    expect(out.mod_id).toBe(7)
    expect(out.mod_downloads).toBe(10)
    expect(out.endorsement_count).toBe(3)
  })
  it('returns null for null input', () => {
    expect(adaptV2Mod(null)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/renderer/nexus-mod-adapt.test.js`
Expected: FAIL — 模組不存在。

- [ ] **Step 3: 建立 adapter 檔**

建立 `src/renderer/src/utils/nexus-mod-adapt.js`（內容搬自 modal 的 `adaptV2Mod`，唯一改動是 `picture_url` 優先 `pictureUrl`）：

```js
// V2 returns camelCase, but the detail render code expects V1's snake_case.
// Adapt the detail payload once so the JSX stays flat.
export function adaptV2Mod(v2) {
  if (!v2) return null
  return {
    ...v2,
    mod_id: v2.modId,
    // Full-resolution picture first — the banner stretches this wide, so a
    // thumbnail here renders blurry. Fall back to thumbnails only when absent.
    picture_url: v2.pictureUrl || v2.thumbnailLargeUrl || v2.thumbnailUrl,
    mod_downloads: v2.downloads,
    mod_unique_downloads: v2.downloads,
    endorsement_count: v2.endorsements,
    updated_timestamp: v2.updatedAt,
    uploaded_by: v2.uploader?.name || v2.author,
    author: v2.author || v2.uploader?.name,
    contains_adult_content: v2.adultContent,
  }
}
```

- [ ] **Step 4: 改 modal 改用 import**

在 `NexusModDetailModal.jsx`：刪除本地 `adaptV2Mod` 函式（約 line 40-56），並在檔案頂部 import 區加：

```js
import { adaptV2Mod } from '../../utils/nexus-mod-adapt';
```

- [ ] **Step 5: 跑測試 + lint 確認通過**

Run: `npx vitest run tests/renderer/nexus-mod-adapt.test.js && npm run lint`
Expected: PASS（4 個測試）+ lint exit 0。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/utils/nexus-mod-adapt.js src/renderer/src/components/modals/NexusModDetailModal.jsx tests/renderer/nexus-mod-adapt.test.js
git commit -m "refactor: extract adaptV2Mod, prefer full-res pictureUrl"
```

---

## Task 4: NexusModDetailModal 版面重排（banner / 統計列 / 分頁）

**Files:**
- Modify: `src/renderer/src/components/modals/NexusModDetailModal.jsx`（render 區，約 line 178-359）
- Modify: `src/renderer/src/index.css`（`.nexus-description`，視需要）

**Interfaces:**
- Consumes: `adaptV2Mod`（Task 3）、`bbcodeToHtml`（Task 2 修好的清單）、既有 `displayMod`/`groupedFiles`/`installedFileIds`/`handleInstallFile`/`isSelf`/`formatCount`/`formatBytes`/`formatDate`。

**無 component 測試環境** — 此 task 以 dev 手動驗證為準（步驟末有清單）。每步都附完整 JSX，照現有 modal 的 className 風格與 `var(--accent-*)` 主題變數。

- [ ] **Step 1: 加分頁 state**

在元件內（`installingFileId` state 之後）新增：

```jsx
  const [activeTab, setActiveTab] = useState('description'); // 'description' | 'files'
```

- [ ] **Step 2: 重排 header → 全圖 banner + 標題壓底**

把現有 `{/* Header */}` 區塊（約 line 193-231，`<div className="relative shrink-0">…`）整段換成全解析度 banner：標題與 installed badge 壓在 banner 底部漸層上。

```jsx
        {/* Banner — full-res picture fills the top; title sits over a
            bottom gradient. No image -> theme-tinted gradient fallback. */}
        <div className="relative shrink-0 h-36 sm:h-44 lg:h-52">
          {thumb ? (
            <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          ) : (
            <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(var(--accent-rgb),0.35), rgba(15,23,42,0.6))' }} />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-white/95 dark:from-slate-900/95 via-white/55 dark:via-slate-900/55 to-transparent" />
          <button onClick={onClose} title="Close"
            className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 shadow-md active:scale-90 transition-all">
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <div className="absolute left-4 sm:left-6 lg:left-8 right-4 bottom-3 sm:bottom-4">
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <h2 className="text-lg sm:text-2xl lg:text-3xl font-black text-slate-900 dark:text-slate-50 leading-tight drop-shadow-sm">{displayMod.name}</h2>
              {installedSet?.has(modIdNum) && (
                <span className="shrink-0 flex items-center gap-1 text-[10px] font-black tracking-widest uppercase px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {t.nexusInstalledLabel}
                </span>
              )}
            </div>
          </div>
        </div>
```

- [ ] **Step 3: 統計列**

緊接 banner 之後（仍在 `shrink-0` 區外、body 之前）放一條統計列：

```jsx
        {/* Stat row */}
        <div className="shrink-0 flex items-center gap-x-3 sm:gap-x-4 gap-y-1 flex-wrap px-4 sm:px-6 lg:px-8 py-2.5 border-b border-slate-200/60 dark:border-slate-700/50 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" />{author}</span>
          {displayMod.version && <span className="font-mono">v{displayMod.version}</span>}
          <span className="flex items-center gap-1"><Download className="w-3.5 h-3.5" />{formatCount(downloads)}</span>
          <span className="flex items-center gap-1"><ThumbsUp className="w-3.5 h-3.5" />{formatCount(endorsements)}</span>
          {displayMod.fileSize != null && <span className="flex items-center gap-1"><FileArchive className="w-3.5 h-3.5" />{formatBytes(Number(displayMod.fileSize))}</span>}
          {displayMod.updated_timestamp && <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{formatDate(displayMod.updated_timestamp)}</span>}
          {displayMod.modCategory?.name && <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{displayMod.modCategory.name}</span>}
          <button onClick={openOnNexus} className="ml-auto flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline">
            <ExternalLink className="w-3.5 h-3.5" />{t.nexusVisitPage}
          </button>
        </div>
```

- [ ] **Step 4: 分頁列（只在載入完成時顯示）**

在 body 容器（`{/* Body */}` 的 `<div className="flex-1 overflow-y-auto …">`）內、`loading`/`error` 判斷**之前**插入 tab 列，並把「描述」「檔案」拆成兩塊內容。tab 列：

```jsx
          {!loading && !error && (
            <div className="flex gap-1 mb-4 border-b border-slate-200/60 dark:border-slate-700/50">
              {[['description', t.readmeTitle || '描述'], ['files', `${t.nexusFiles}${files.length ? ` (${files.length})` : ''}`]].map(([key, label]) => (
                <button key={key} onClick={() => setActiveTab(key)}
                  className={`px-4 py-2.5 text-[13px] font-bold transition-colors ${activeTab === key ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}
                  style={activeTab === key ? { borderBottom: '2px solid var(--accent-500)', marginBottom: '-1px' } : undefined}>
                  {label}
                </button>
              ))}
            </div>
          )}
```

- [ ] **Step 5: 描述 tab 內容**

在 `loading`/`error` 三元判斷的成功分支裡，把原本 `<div className="flex flex-col gap-6">` 內容拆成兩個條件區塊。描述分頁（`activeTab === 'description'`）：summary 摘要框 + `descriptionHtml`（沿用既有 `dangerouslySetInnerHTML` + `handleReadmeClick`）：

```jsx
              {activeTab === 'description' && (
                <div className="flex flex-col gap-5">
                  {displayMod.summary && (
                    <p className="text-sm text-slate-600 dark:text-slate-300 italic leading-relaxed border-l-[3px] border-slate-300 dark:border-slate-700 pl-4">
                      {displayMod.summary}
                    </p>
                  )}
                  {descriptionHtml
                    ? <div className="nexus-description" onClick={handleReadmeClick} dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
                    : <p className="text-xs text-slate-400 dark:text-slate-500 italic">{displayMod.summary ? '' : 'No description.'}</p>}
                </div>
              )}
```

- [ ] **Step 6: 檔案 tab 內容**

檔案分頁（`activeTab === 'files'`）沿用既有的分類分組 + 安裝按鈕。把原本 `{/* Files */}` 整塊（約 line 262-352，從 `<div>` 含 `<h3>…{t.nexusFiles}` 到對應收尾）搬進此條件，但**移除**裡面那個重複的 `<h3>…{t.nexusFiles}</h3>` 標題（tab 已標示）：

```jsx
              {activeTab === 'files' && (
                <div className="flex flex-col gap-4">
                  {CATEGORY_ORDER.map(cat => {
                    /* …既有的分組 map 原封不動… */
                  })}
                  {Object.keys(groupedFiles).length === 0 && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 italic">No downloadable files.</p>
                  )}
                </div>
              )}
```

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: exit 0。若有未使用 import（例如 summary 區改動後），一併清掉。

- [ ] **Step 8: 手動驗證（dev）**

清單（dev 開著，點 Nexus 分頁 → 任一模組詳細頁）：
1. Banner 用全解析度大圖、不模糊；標題壓在底部漸層上清楚可讀。
2. 無圖的模組顯示主題色漸層 fallback、不破版。
3. 統計列：作者/版本/下載/讚/大小/日期/分類齊全，「在 Nexus 開啟」靠右。
4. 「描述」「檔案」分頁可切換；描述內 `✦ 特色` 有圓點、`✦ 安裝` 有數字、`zh_P.pak` 是 code 樣式、**無 `[/*]`、無亂碼**。
5. 檔案分頁安裝按鈕（含已安裝 / 安裝中 / This app）狀態正常。
6. 視窗縮放：banner/統計/分頁在窄寬度不破版。

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/modals/NexusModDetailModal.jsx src/renderer/src/index.css
git commit -m "feat: redesign Nexus mod detail with banner, stat row, tabs"
```

---

## Self-Review

- **Spec coverage：** §1.1 圖片模糊 → Task 3；§1.2 BBCode `[/*]` → Task 2；§1.3 U+FFFD → Task 1；§2 版面（banner/統計/分頁/summary/描述/檔案）→ Task 4；§3 資料能力（不做圖庫）→ Global Constraints + Task 4 只用既有欄位；§4 元件分解 → File Structure 表；§5 測試 → Task 1/2/3 的 vitest + Task 4 手動清單；§6 範圍/相容/安全 → Global Constraints。全覆蓋。
- **Placeholder scan：** 無 TBD/TODO；每個改 code 的步驟都附完整程式碼。Task 4 Step 6 的「既有分組 map 原封不動」指向 Task 4 Files 已標明的現有行段，非佔位。
- **Type consistency：** `decodeUtf8Chunks(Buffer[]) → string`（Task 1）一致；`adaptV2Mod(v2) → {picture_url, mod_id, mod_downloads, endorsement_count, updated_timestamp, …}`（Task 3）與 Task 4 消費的 `displayMod.*` 欄位一致；`bbcodeToRawHtml`/`bbcodeToHtml`（Task 2）與既有 `_testInternals` 一致；`activeTab` 值 `'description'|'files'`（Task 4）前後一致。
