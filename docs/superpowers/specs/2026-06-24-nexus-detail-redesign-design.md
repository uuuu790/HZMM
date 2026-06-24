# Nexus 模組詳細頁重新設計 + 編碼/BBCode 修復

**目標：** 修掉 NexusModDetailModal 的三個明確 bug（圖片模糊、BBCode 清單殘留 `[/*]`、中文 U+FFFD 亂碼），並把版面重排成更接近 Nexus 的質感（大 banner、統計卡列、描述/檔案分頁）。

**範圍：** 一個 modal 的重排 + 兩個後端修復（V2 解碼、BBCode 清單）。不是新功能，是改善既有元件。

---

## 1. 根源確診（皆已定位）

### 1.1 圖片模糊
`NexusModDetailModal.jsx` 的 `adaptV2Mod` 把 `picture_url` 設為 `thumbnailLargeUrl || pictureUrl || thumbnailUrl` —— 優先用**縮圖**，再被 banner 的 `object-cover` 拉到全寬（最高 192px、寬至 85vw），縮圖解析度不足 → 糊。
**修法：** 優先用全解析度 `pictureUrl`（`pictureUrl || thumbnailLargeUrl || thumbnailUrl`）。

### 1.2 BBCode 清單殘留 `[/*]`
`utils/bbcode.js` 的清單規則用 `body.split(/\[\*\]/)` 切項目，只處理開頭 `[*]`，**不處理閉合 `[/*]`**。作者用 `[*]內容[/*]` 配對形式時，`[/*]` 殘留在項目文字裡顯示出來；清單未用 `[list]` 包裹時，連項目符號（圓點/數字）都消失。截圖的「特色」「安裝」兩區即此症狀。
**修法：** 清單處理需涵蓋 (a) 移除 `[/*]` 閉合標籤；(b) 裸 `[*]`（無 `[list]` 包裹）也包成清單；(c) `[list]`/`[list=1]` 正確產生帶圓點/數字的 `<ul>`/`<ol>`。實作時以該模組（HumanitZ 繁體中文化）的 raw description 及新增 vitest 案例驗證確切格式。

### 1.3 中文 U+FFFD 亂碼
`nexus-v2-client.js` 的 `gqlRequest` 用 `let data = ''; res.on('data', c => data += c)` 收 response —— 字串 `+=` Buffer 會對**每個 chunk 各自** `toString('utf8')`。當一個多位元組 UTF-8 字元（中文 3 bytes）跨越 TCP chunk 邊界時，兩段不完整序列各自解碼成 U+FFFD（`譯` → ）。這是我們自己抓壞的，非 Nexus 端資料問題，且影響所有 V2 回應（剛好落在邊界的字元）。
**修法：** 改用 `res.setEncoding('utf8')`（內部 StringDecoder 正確處理跨 chunk 邊界），或收集 Buffer chunks 後 `Buffer.concat(chunks).toString('utf8')`。

---

## 2. 版面設計（mockup 已核准）

詳細頁由上到下：

1. **大 banner** — `pictureUrl` 全解析度鋪滿頂部（`object-cover`），底部漸層遮罩；標題與 installed badge 壓在 banner 底部。無圖模組以漸層 fallback。
2. **統計卡列** — banner 下一橫排（flex wrap）：作者、版本、下載數、讚數、檔案大小、更新日、分類、「在 Nexus 開啟」連結。
3. **分頁** — `描述` | `檔案` 兩個 tab（React `useState`），預設「描述」；切換不重新抓資料（detail/files 一次載入後快取於 state）。
4. **描述 tab** — summary 摘要框（斜體 border-left）+ description 內文（`bbcodeToHtml`，修好的清單）。
5. **檔案 tab** — 沿用現有的依 Nexus 分類分組（Main/Optional/Update/Misc/Old）檔案列表與安裝按鈕，含 file count 標於 tab。

accent 色沿用 runtime 主題色（`var(--accent-500)` 等），不寫死。

---

## 3. 資料能力（V2 ModDetail）

**可用：** name, summary, description, author, version, `pictureUrl`（全解析度）, endorsements, downloads, fileSize, adultContent, updatedAt, modCategory, uploader；files（`v2GetModFiles`）。
**沒有：** 多圖圖庫（screenshots）、posts/bugs/留言。→ **不做圖庫輪播**（資料拿不到）。

---

## 4. 元件分解

| 檔案 | 職責 | 變更 |
|---|---|---|
| `src/main/ipc/nexus-v2-client.js` | V2 GraphQL client | `gqlRequest` UTF-8 解碼修復 |
| `src/renderer/src/utils/bbcode.js` | BBCode → 安全 HTML | 清單 `[*]`/`[/*]` 修復 |
| `src/renderer/src/components/modals/NexusModDetailModal.jsx` | 詳細頁 modal | `adaptV2Mod` 圖片來源 + 版面重排（banner / 統計列 / 分頁） |
| `src/renderer/src/index.css` | `.nexus-description` 樣式 | 視需要微調清單/間距 |

---

## 5. 測試

- **`bbcode.js`**（vitest，擴充現有 56 案例）：`[*]a[*]b`、`[*]a[/*][*]b[/*]`、`[list][*]a[/*][/list]` → 正確 `<ul><li>` 且無 `[/*]` 殘留；`[list=1]…` → `<ol>`。
- **`nexus-v2-client.js`**（vitest）：模擬 response 在多位元組字元中間切成兩個 chunk，驗證解碼後無 U+FFFD、字串完整。
- **圖片來源**：`adaptV2Mod` 優先 `pictureUrl`（若抽成可測純函式則單元測試，否則隨 modal 手動驗證）。
- **Modal 版面**：無 component harness，dev 手動驗證（banner、分頁切換、無圖 fallback、響應式）。

---

## 6. 範圍 / YAGNI / 向後相容

- **不做：** 圖庫輪播（無資料）、posts/bugs、留言、追蹤/讚等寫入動作。
- **向後相容：** V1 fallback 欄位（snake_case via `adaptV2Mod`）維持；無圖模組走漸層 fallback；解碼修復對所有 V2 呼叫透明，不改 API 形狀。
- **安全：** `bbcodeToHtml` 的 DOMPurify sanitize 管道不變；BBCode 清單修復只動標籤轉換、不放寬 sanitize；解碼修復不影響安全性。
