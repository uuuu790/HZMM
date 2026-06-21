# 設計：已安裝 Mod 更新檢查

> 日期：2026-06-21
> 狀態：已確認，待規劃實作

## 目標與動機

HZMM 已能從 Nexus 瀏覽並安裝 mod，但**安裝後不會主動告訴使用者哪些 mod 已過時**。使用者必須自己回 Nexus 逐一比對版本。本功能利用既有的 Nexus 整合與安裝記錄，自動檢查已安裝 mod 是否有新版，並就地提示與更新 —— 這是 mod manager 最核心的長期價值。

## 範圍

**涵蓋（in scope）**
- 透過 HZMM 從 Nexus 安裝、且有 install receipt 的 mod
- 啟動時自動檢查（節流）+ 手動重檢
- ModulesTab 就地 inline 過時提示 + 更新操作
- 有 API key：一鍵下載安裝（複用現有流程）；無 key：跳轉 Nexus 頁面

**不涵蓋（out of scope）**
- 手動拖放安裝、無 Nexus 關聯的 mod（無可靠版本來源）
- mod 之間相依關係 / 版本相容性分析
- 自動（無提示）更新

## 1. 比對邏輯

對每個 Nexus install receipt `{ modId, fileId, installedAt, localMods, version? }`，呼叫 `v2GetModFiles(modId)`（V2 GraphQL，**免 API key**），找該 mod 的**最新 main file**（`category` 為 main 的 files 中 `date` 最大者），判定是否過時：

- **receipt 有 `fileId`**：最新 main file 的 `file_id` ≠ `fileId` 且 `date` 較新 → 過時
- **receipt `fileId === null`**（當初裝 latest main）：最新 main file 的 `date > installedAt` → 過時

判定結果結構：
```
{ modId, outdated: boolean, latestFileId, latestVersion, currentVersion?, error? }
```

`recordInstall` 增存 `version`（安裝當下的版本字串），讓 badge 能顯示「v1.2 → v1.5」。**向後相容**：舊 receipt 無 `version` 欄位時，badge 退回顯示「有更新（v1.5）」，比對改用 `installedAt`。不破壞既有 receipt 結構。

## 2. 節流與快取

新增 `nexusUpdateCheck` 快取（configStore）：
```
{ checkedAt: number, results: { [modId]: { outdated, latestFileId, latestVersion } } }
```
- **啟動檢查**：`now - checkedAt > 6h` 才真正打 API，否則直接用快取結果
- **手動重檢**：強制忽略快取、重新查詢
- 查詢在 main process **逐一序列化**（避免一次轟炸 Nexus API 觸發 rate limit），背景執行不阻塞 UI

節流時間 6h 為預設常數，集中定義便於日後調整。

## 3. 後端架構

| 檔案 | 變更 |
|---|---|
| `src/main/ipc/nexus-update-checker.js`（新增） | `checkUpdates(force)` → 過時清單；純邏輯，可單元測試 |
| `src/main/ipc/nexus.js` | 註冊 `nexus:check-updates` / `nexus:check-updates-force` IPC，thin-wrap checker |
| `src/main/ipc/nexus-install-tracker.js` | `recordInstall` 增存 `version`；更新成功後刷新 receipt（新 fileId/version/installedAt） |
| `src/preload/index.js` | 暴露 `nexus.checkUpdates()` / `nexus.checkUpdatesForce()` |

**更新執行完全複用**現有 `nexus:install-file`（V1 download_link 需 API key → `installMods` → `withRollback` rollback 保護）。成功後刷新 receipt → 過時狀態與 badge 自動消失。

## 4. 前端 UI（就地 inline）

- **ModulesTab 卡片**：過時 mod 顯示琥珀色 badge「↑ 有更新 v1.2 → v1.5」+「更新」按鈕
  - 有 API key：點按鈕 → 走現有安裝流程（進度複用 `mods:download-progress`）→ rollback 保護
  - 無 key：按鈕為「在 Nexus 查看」→ 開 mod 頁面，旁註「設定 API key 可一鍵更新」
- **Sidebar**：Modules 項目旁顯示可更新總數 badge「N」，沿用現有設計語言
- 新 hook `useUpdateChecker`：啟動觸發、過時清單狀態、手動重檢、更新進行中狀態

設計品質：badge 與按鈕需符合 HZMM 既有的視覺水準（間距、色彩、動畫過渡），與 inline rename / Nexus 安裝按鈕一致。

## 5. 錯誤與邊界處理

- **V2 查詢失敗 / mod 被 Nexus 下架**：該 mod 標記 `error`、UI 顯示「無法檢查」，**不阻擋**其他 mod 的檢查
- **更新失敗**：現有 `withRollback` 還原舊版，沿用既有錯誤呈現模式向使用者顯示
- **並行更新**：現有 install mutex（`serializeModWrite`）已涵蓋
- **舊 receipt（無 version）**：退回 `installedAt` 比對，badge 不顯示當前版本號
- **離線 / 無網路**：檢查靜默失敗，保留上次快取結果，不打擾使用者

## 6. 測試策略

- `checkUpdates` 比對邏輯單元測試：有/無 `fileId`、過時/最新、mod 下架（V2 回空）、`fileId===null` 的 date 比對
- 節流邏輯測試：快取命中（6h 內）vs 過期重檢 vs force
- receipt `version` 向後相容測試：舊 receipt（無 version）仍正確比對與顯示
- 不破壞既有 466 測試；audit / lint 維持乾淨

## 7. 檔案清單與工作量

**新增**
- `src/main/ipc/nexus-update-checker.js`
- `tests/ipc/nexus-update-checker.test.js`
- `src/renderer/src/hooks/useUpdateChecker.js`

**修改**
- `src/main/ipc/nexus.js`（IPC 註冊）
- `src/main/ipc/nexus-install-tracker.js`（receipt version）
- `src/preload/index.js`（channel）
- `src/renderer/src/components/tabs/ModulesTab.jsx`（badge + 更新按鈕）
- `src/renderer/src/components/common/ModuleList.jsx`（若卡片邏輯在此）
- `src/renderer/src/components/layout/Sidebar.jsx`（計數 badge）
- `src/renderer/src/App.jsx`（接線 hook）
- `src/renderer/src/constants/i18n/*.js`（7 語言新 key）

**規模**：中等。大量複用既有 Nexus / install / rollback 基礎，不需新的下載或安裝邏輯。
