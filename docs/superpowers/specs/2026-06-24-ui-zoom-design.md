# 介面縮放（UI Zoom）設計

**目標：** 讓使用者用設定頁滑桿與快捷鍵縮放整個介面（字、按鈕、圖示一起等比例），解決字體偏小，並持久化記住設定。

**範圍：** 一個整體縮放控制 + 持久化 + 快捷鍵。不做字型選擇、UI 密度、per-element 縮放（YAGNI）。

---

## 1. 機制

Electron `webFrame.setZoomFactor(factor)` 縮放整個 renderer，等比例放大字、按鈕、圖示，**不需改任何現有 px 樣式**。`factor` 為 1.0 = 100%。

`preload/index.js` 已 `require('electron')`，加入 `webFrame`，暴露：
- `window.api.ui.setZoom(factor)` → `webFrame.setZoomFactor(factor)`
- `window.api.ui.getZoom()` → `webFrame.getZoomFactor()`

---

## 2. 縮放範圍與規則

- 範圍 **0.5–2.0**（50%–200%），滑桿 step **0.1**（10%）。
- 一律經 `clampZoom(z) = Math.max(0.5, Math.min(2.0, z))` 夾住（純函式，可測）。
- 預設 **1.0**（100%）。

---

## 3. 持久化與啟動套用

- 存 configStore key **`uiZoom`**（number，預設 1.0），透過既有 `settings:get` / `settings:set` IPC。
- **啟動套用（避免閃動）：** `main/index.js` 在 `mainWindow.webContents.on('did-finish-load', …)` 讀 `configStore.get('uiZoom', 1)` 並 `webContents.setZoomFactor(z)`。頁面載入完成即套用上次的縮放。

---

## 4. 設定頁 UI

`SettingsTab.jsx` 在「外觀」區（主題切換附近）新增一個「**介面縮放**」卡片 row，沿用既有 row 樣式：
- 標題 `t.uiZoom` + 說明 `t.uiZoomDesc`。
- 一個 `<input type="range" min=0.5 max=2 step=0.1>` 滑桿，`onChange` 即時 `setZoom` + 持久化。
- 右側顯示目前百分比（`${Math.round(zoom*100)}%`）。
- 一個「**重置**」按鈕（`t.uiZoomReset`）回到 1.0。

縮放狀態由 renderer 的設定狀態層（與 `minimizeToTray` / `autoStart` 同一處）持有：新增 `uiZoom` state + `setUiZoom(factor)`（呼叫 `window.api.ui.setZoom(clampZoom(factor))` 並 `persistSetting('uiZoom', …)`），以 prop 傳入 SettingsTab。

---

## 5. 快捷鍵

renderer 端全域 `keydown`（App 層 useEffect）攔截，`preventDefault` 後呼叫上面的 `setUiZoom`：
- `Ctrl` + `=`／`+` → 放大一格（+0.1）
- `Ctrl` + `-` → 縮小一格（−0.1）
- `Ctrl` + `0` → 重置為 1.0

（攔截以覆蓋 Electron 預設的 zoom 行為，確保走我們的 clamp + 持久化。）

---

## 6. i18n

新增字串 × 7 語言（zh-TW 為 reference）：`uiZoom`（介面縮放）、`uiZoomDesc`（縮放整個介面的字體與元件）、`uiZoomReset`（重置）。

---

## 7. 元件分解

| 檔案 | 職責 | 變更 |
|---|---|---|
| `src/preload/index.js` | IPC bridge | 加 `webFrame` import；暴露 `ui.setZoom` / `ui.getZoom` |
| `src/main/index.js` | window 建立 | `did-finish-load` 套用 saved `uiZoom` |
| renderer 設定狀態層（與 `minimizeToTray` 同處） | 設定狀態 | `uiZoom` state + `setUiZoom` |
| `src/renderer/src/components/tabs/SettingsTab.jsx` | 設定 UI | 外觀區「介面縮放」滑桿 row |
| App 層（快捷鍵） | 鍵盤 | `Ctrl +/−/0` keydown |
| `src/renderer/src/utils/`（新）`zoom.js` | 純邏輯 | `clampZoom` + `stepZoom` |
| i18n ×7 | 字串 | `uiZoom` / `uiZoomDesc` / `uiZoomReset` |

---

## 8. 測試

- **`clampZoom` / `stepZoom`**（純函式，vitest）：夾在 0.5–2.0；step 加減 0.1 並 clamp；邊界。
- **滑桿 / 快捷鍵 / 啟動套用**：無 component harness，dev 手動驗證（拖滑桿即時縮放、快捷鍵、重開 app 記住縮放）。

---

## 9. 範圍 / YAGNI / 向後相容

- **不做：** 字型選擇、UI 密度/間距、per-element 字級。
- **向後相容：** `uiZoom` 預設 1.0 → 現狀不變；`webFrame` 縮放是 renderer 視覺層，不影響任何 layout 或業務邏輯。
- 縮放為 per-app（單一 mainWindow），無多視窗問題。
