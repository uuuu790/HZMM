# 設計：模組庫 Lua / C++ 子分類

> 日期：2026-06-24
> 狀態：已確認，待規劃實作

## 目標與動機

HZMM 的模組庫目前把模組分成兩個區塊：**PAK Mods** 和 **UE4SS Mods**。但 UE4SS 模組其實有兩種形式 —— **Lua 腳本模組**（`Scripts/main.lua`）和 **C++ 模組（cppmod，`dlls/main.dll`）** —— 兩者現在全混在同一個「UE4SS Mods」區塊裡，使用者無法一眼分辨某個模組是腳本還是編譯好的 DLL。

後端其實**早已偵測得到** C++ 模組（`isUe4ssMod()` 已檢查 `dlls/main.dll` 與根級 `.dll`），只是這個資訊沒往上傳、前端也沒呈現。本功能把這個既有資訊標記出來，讓模組庫在 UE4SS 區塊內再分 Lua / C++ 子群組。

## 設計前提：C++ 是 UE4SS 的子類

C++ 模組與 Lua 模組**都由 UE4SS 載入驅動**，差別只在進入點與本質：

| | Lua 模組 | C++ 模組（cppmod） |
|---|---|---|
| 進入點 | `Scripts/main.lua` 或根目錄 `main.lua` | `dlls/main.dll` |
| 本質 | UE4SS 內建 Lua runtime 直譯腳本 | UE4SS 載入編譯好的 DLL（實作 `CppUserModBase`） |
| 位置 | `UE4SS/Mods/<名稱>/` | 同左 |
| 啟用機制 | 資料夾內 `enabled.txt` | **完全相同** |

因此分類階層為「PAK vs UE4SS，UE4SS 底下再分 Lua / C++」—— C++ **不**與 UE4SS 平行。這是整個設計的核心約束，決定了用 `subtype` 而非新增 `type` 值。

## 範圍

**涵蓋（in scope）**
- 後端為 UE4SS 模組標記 `subtype: 'lua' | 'cpp'`
- 模組庫「全部」視圖：UE4SS 區塊內以 Lua / C++ 子標頭分組
- 篩選列新增 C++ 快捷
- C++ 子類專屬 icon / 顏色
- i18n（7 語言）字串

**不涵蓋（out of scope）**
- Dashboard 統計、Profiles 匯出的 Lua/C++ 細分（維持 PAK / UE4SS 大類，見 §5）
- PAK 模組的任何子分類
- 改變 `type` 欄位既有值或 hybrid 連動邏輯

## 1. 分類判定邏輯

掃描 UE4SS 模組資料夾時，沿用現有偵測訊號決定 `subtype`：

- 有 `Scripts/main.lua` 或根目錄 `main.lua` → `'lua'`
- 否則有 `dlls/main.dll` 或任何根級 `.dll` → `'cpp'`

**邊界情況（明確規則）**：

| 資料夾內容 | subtype | 理由 |
|---|---|---|
| 只有 Lua entry | `'lua'` | 純腳本模組 |
| 只有 `dlls/main.dll` 或根級 `.dll` | `'cpp'` | 純 cppmod |
| **同時有 Lua entry + DLL** | `'lua'` | 主要邏輯走 Lua，DLL 視為附屬資源；以使用者撰寫意圖的主體為準 |
| 兩者皆無但仍被認為是 UE4SS mod | `'lua'` | 退化預設（理論上 `isUe4ssMod()` 不會回 true，防禦性處理） |

判定集中在一個純函式，方便單元測試（見 §6）。

## 2. 資料結構

模組物件目前 `type: 'PAK' | 'UE4SS'`。**不改 `type`**，新增可選欄位：

```js
{ type: 'UE4SS', subtype: 'lua' | 'cpp', ... }   // PAK 模組不帶 subtype
```

| 方案 | 取捨 |
|---|---|
| A. `type` 加第三值 `'C++'` | ❌ 破壞「C++ 是 UE4SS 子類」的階層；hybrid 連動、Profiles 匯出、Dashboard 統計全都假設 `type ∈ {PAK, UE4SS}`，需改多處，回歸風險高 |
| **B. 新增 `subtype`（採用）** | ✅ 完全向後相容；`isUe4ssMod()` 照常運作；hybrid / profile / dashboard 邏輯一行不動，只是多帶一個欄位供前端分組 |

## 3. 後端架構

| 檔案 | 變更 |
|---|---|
| `src/main/ipc/mods-scan.js` | 新增分類純函式（例如 `classifyUe4ssMod(modDir) → 'lua' \| 'cpp'`），在組裝 UE4SS 模組物件處（現約 134–145 行）填入 `subtype` |

其他後端檔案（`mods.js`、`archive.js`、`mods-install.js`、`nexus-*`）**不動** —— 因為 `type` 沒變，現有契約完全相容。

## 4. 前端 UI

### 4.1 視覺（modIcons.js）

| 分類 | 顏色 | icon | 語意 |
|---|---|---|---|
| PAK | indigo（既有） | `Package`（既有） | 打包檔 |
| UE4SS · Lua | emerald（既有） | `Puzzle`（既有） | 腳本拼圖 |
| **UE4SS · C++** | **amber（琥珀）** | **`Binary`** | 編譯好的二進位 DLL |

amber 與 indigo / emerald 區隔明確，三者一眼可分。間距、圓角、陰影沿用既有模組卡片語言。

### 4.2 ModulesTab.jsx

- 篩選列：`['全部', 'PAK', 'UE4SS', 'C++']`
  - `UE4SS` = 所有 UE4SS（Lua + C++）
  - `C++` = 只看 `subtype === 'cpp'`
  - `processedModules` 過濾：`filterType === 'C++'` → `m.type === 'UE4SS' && m.subtype === 'cpp'`
- 「全部」視圖：`UE4SS Mods` 大區塊內，用 **Lua / C++ 兩個子標頭**分組；**空的子組不顯示**。
- 單獨篩選視圖一致：選 `UE4SS` 同樣以 Lua / C++ 子標頭分組；選 `C++` 只剩 C++ 一組；選 `PAK` 維持原樣（無子標頭）。

### 4.3 ModuleList.jsx

- 新增可選 `subtype` prop。
- 過濾條件：`m.type === type && (!subtype || m.subtype === subtype)`。
- UE4SS 區塊渲染為一個大標題 + 兩個依 subtype 分段的子群組（各帶 §4.1 的子類視覺）。

### 4.4 i18n（7 語言檔）

`en / zh-TW / ja / de / ko / fr / ru` 新增分組標頭與篩選字串。`"Lua"`、`"C++"` 為專有名詞，各語言通用，僅周邊文字（如「Mods」「篩選」）需在地化。

## 5. 範圍邊界（刻意不做）

- **DashboardTab 統計**、**ProfilesTab 匯出** 維持 PAK / UE4SS 兩個大類，**不細分** Lua / C++。
  - 理由：這兩處關心的是「啟用 / 停用機制」，而 Lua 與 C++ 的啟用機制**完全相同**，細分只增加雜訊而無資訊價值。
  - 聚焦在「模組庫」本身，符合需求範圍，也限制回歸面。

## 6. 測試

**後端（mods-scan 分類函式）** — fixture 四案：
1. Lua-only（`Scripts/main.lua`）→ `'lua'`
2. cpp-only（`dlls/main.dll`）→ `'cpp'`
3. 根級 `.dll`（無 `dlls/` 子目錄）→ `'cpp'`
4. Lua + DLL 混合 → `'lua'`（驗證邊界規則）

**前端**：
- 「全部」視圖 UE4SS 區塊正確拆成 Lua / C++ 子組；空子組不顯示。
- `C++` 篩選只顯示 `subtype === 'cpp'` 的模組。
- PAK 區塊與既有行為不受影響（無 `subtype` 不報錯）。

## 改動範圍總結

後端 **1** 個檔案（`mods-scan.js`）+ 前端 **3** 個（`modIcons.js`、`ModulesTab.jsx`、`ModuleList.jsx`）+ i18n 7 語言檔。向後相容，回歸面小，聚焦模組庫。
