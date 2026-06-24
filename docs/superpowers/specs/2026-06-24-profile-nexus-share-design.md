# 設計：配置檔帶 Nexus 來源 + 匯入自動下載

> 日期：2026-06-24
> 狀態：已確認，待規劃實作

## 目標與動機

HZMM 已能匯出/匯入配置檔（profile），但 profile 只記「啟用哪些 mod + 設定」，**不含 mod 本身**。別人匯入後，套用時只會啟用「他已經安裝的」mod，缺少的不會自動補 —— 要完整重現一份配置，對方得自己先把所有 mod 裝好。

本功能讓配置檔帶上每個 mod 的 **Nexus 來源**（modId/fileId/version），別人匯入並套用時，**自動從 Nexus 下載缺少的 mod**，達成「一鍵直接使用我的配置」。無法自動取得的，列清單 + Nexus 連結讓對方手動補完。

## 範圍

**涵蓋（in scope）**
- Profile 匯出時反查並夾帶每個 mod 的 Nexus 來源
- 套用 profile 時偵測缺少的 mod，自動下載有 Nexus 來源者
- 鎖定原 fileId，下架時 fallback 到最新版
- 無法自動下載者（無來源 / 沒 Premium key / 都下架）列清單 + Nexus 連結
- 匯入流程的缺失清單 modal（可自動 / 需手動 + 下載進度）

**不涵蓋（out of scope）**
- 打包 mod 檔案本身（離線包）
- 雲端分享碼 / 後端服務
- 非 Nexus 來源 mod 的自動取得（GitHub 等）
- 自動解決 mod 之間的相依/相容性

## 1. Profile 格式擴充（向後相容）

現有 profile 結構不變，新增一個可選欄位：

```js
{
  id, name,
  enabledModFilenames,   // 既有：啟用的 mod 檔名（normalized）
  configSnapshot,        // 既有：UE4SS mod 設定快照
  createdAt,
  nexusSources: [        // 新增：每個「有 Nexus 來源」的 mod 一筆
    { key, modId, fileId, version, displayName }
  ]
}
```

- `key`：`localModKey` 格式（`PAK:<base>` / `UE4SS:<folder>`），用來和本機掃描結果對應。
- `fileId`：匯出者當初安裝的特定版本（鎖定用）。`version`：版本字串（顯示用）。
- **安全：API key 絕不寫進 profile。** 匯入者一律用自己機器上設定的 key 下載。
- **向後相容**：舊 profile 無 `nexusSources` → 匯入照舊運作，套用時不嘗試自動下載。匯入驗證仍只要求 `name` + `enabledModFilenames`。

## 2. 匯出（反查 Nexus 來源）

新增 IPC `profiles:resolve-nexus-sources(enabledModFilenames) → nexusSources[]`：

- 後端讀 `configStore.get('nexusInstalledMods')`（install receipts）。
- 對每個 `enabledModFilename`，用 `localModKey` 正規化後，比對 receipt 的 `localMods`（同樣 key 格式）找出對應 receipt → 取 `modId/fileId/version`。
- 查不到 receipt 的（手動拖放裝的）**不列入** `nexusSources` —— 對方匯入時會被歸到「需手動」。
- 前端 `handleExportProfile` 匯出前呼叫此 IPC，把結果塞進 profile 再序列化。

## 3. 匯入 + 套用流程

**匯入**（`handleImportProfile`）：驗證 + 加入清單，原樣保留 `nexusSources`（若有）。

**套用**（`handleApplyProfile`）—— 偵測與下載放在「套用」時，因為套用才是真正要用這份配置的時刻：

1. 比對 `profile.enabledModFilenames` vs 本機 `modules`（`mods:scan`）→ 找出**缺少的** mod（profile 要啟用、但本機掃不到）。
2. 缺少的查 `profile.nexusSources`，分兩類：
   - **可自動下載**：有對應 source **且**本機有 Premium key（`nexus:validate` → `is_premium`）。
   - **需手動**：無 source（手動裝的）／沒 Premium key／或下載失敗。
3. 跳出 **匯入缺失 modal**：「此配置缺 N 個 mod —— X 個可自動下載，Y 個需手動」。
4. 使用者確認 → 自動下載 X 個（逐一序列化，進度條複用 `mods:download-progress`），Y 個列清單，有 `modId` 者附 `https://www.nexusmods.com/humanitz/mods/<modId>` 連結，點開外部瀏覽器手動裝。
5. 全部就緒 → 執行既有套用邏輯（toggle 啟用/停用 + `restoreConfigs`）。

若無任何缺失，直接套用（現行行為不變）。

## 4. 下載（fileId 鎖定 + fallback）

`nexus:install-file(modId, fileId, version)` 加入 fallback：

- 先用原 `fileId` 解析 download_link。
- 若該 file 下架（HTTP 403 file-not-found / 404 / `download_link` 失敗）→ 查該 mod 最新 main file（`/files.json`，`category_id === 1`，最新 `uploaded_timestamp`）→ 改下載最新版，並在結果標記 `fellBackToLatest: true`（UI 提示「版本可能與原配置不同」）。
- Premium gating 不變：沒 Premium key 的 mod 在步驟 3 已歸「需手動」，不會走到這。

## 5. 改動範圍

| 層 | 檔案 | 變更 |
|---|---|---|
| 後端 | `nexus-install-tracker.js` | 新增反查 helper：`resolveSourcesForFilenames(filenames) → sources[]` |
| 後端 | `nexus.js` | 註冊 `profiles:resolve-nexus-sources`；`nexus:install-file` 加 fileId fallback |
| 後端 | `preload/index.js` | 暴露 `nexus.resolveProfileSources(filenames)` |
| 前端 | `useProfileHandlers.js` | 匯出時組 `nexusSources`；套用時偵測缺失 + 觸發下載流程 |
| 前端 | `ProfileImportModal.jsx`（新增）| 缺失清單（可自動 / 需手動）+ 下載進度 + 手動連結 |
| 前端 | i18n（7 語言）| 新增缺失/下載/手動相關字串 |

## 6. 錯誤與邊界處理

- **沒 Premium key**：所有有 source 的缺失 mod 一律歸「需手動」，modal 提示「到設定填 Premium API Key 可自動下載」。
- **fileId 下架**：fallback 最新版，標記提示版本差異。
- **單一下載失敗**：標記該 mod 為「需手動」，繼續其餘，不中止整批。
- **舊 profile（無 nexusSources）**：套用時不偵測下載，行為與現狀完全一致。
- **API key 隱私**：匯出資料不含 key（驗證序列化結果無 key 欄位）。

## 7. 測試

- 反查：給定 `enabledModFilenames` + 模擬 `nexusInstalledMods`，驗證 `nexusSources` 正確（含 key 正規化、查不到者排除）。
- fileId fallback：原 fileId 失敗 → 改抓最新 main file。
- 缺失偵測：profile 要的 mod 在本機掃不到 → 列入缺失；分類可自動 / 需手動正確。
- 向後相容：舊 profile（無 nexusSources）套用不報錯、不嘗試下載。
- 安全：匯出 JSON 不含 API key。
