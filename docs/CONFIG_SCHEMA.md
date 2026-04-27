# HZMM Config Schema Standard

> `hzmm.config.json` specification for mod authors who want rich UI in HZMM's config editor.
>
> Version: **1.1** | Supported: HZMM v1.3.6+

---

## Overview

Place a `hzmm.config.json` file alongside your `config.lua`. HZMM will use it to render
a polished, localized config editor instead of relying on comment parsing.

```
YourMod/
  main.lua
  config.lua            <-- actual values (mod reads this)
  hzmm.config.json      <-- UI schema (HZMM reads this)
```

If `hzmm.config.json` is not present, HZMM falls back to comment-based parsing.

---

## What's New in 1.1

| Feature | Where | Summary |
|---------|-------|---------|
| `color` type | key | Hex color picker (`#RRGGBB`) |
| `keybind` type | key | Keyboard shortcut capture (`Ctrl+Shift+F`, `F6`, …) |
| `collapsed` | section | Section starts folded; click header to expand |
| Default reset | key (UI only) | When a key has `default`, HZMM shows a hover-only ↺ button to restore it. No schema change required |

All 1.1 additions are backward compatible — schemas written for 1.0 keep working unchanged.

---

## Quick Start

**config.lua:**
```lua
local Config = {
  MaxHealth = 100,
  Difficulty = "normal",
}
return Config
```

**hzmm.config.json:**
```json
{
  "configFile": "config.lua",
  "sections": {
    "General": {
      "label": { "en": "General", "zh-TW": "一般" },
      "keys": {
        "MaxHealth": {
          "type": "int",
          "default": 100,
          "min": 1,
          "max": 9999,
          "label": { "en": "Max Health", "zh-TW": "最大生命值" },
          "description": { "en": "Maximum player health", "zh-TW": "玩家最大血量" }
        },
        "Difficulty": {
          "type": "select",
          "default": "normal",
          "label": { "en": "Difficulty", "zh-TW": "難度" },
          "options": [
            { "value": "easy", "label": { "en": "Easy", "zh-TW": "簡單" } },
            { "value": "normal", "label": { "en": "Normal", "zh-TW": "標準" } },
            { "value": "hard", "label": { "en": "Hard", "zh-TW": "困難" } }
          ]
        }
      }
    }
  }
}
```

---

## Schema Structure

```
hzmm.config.json
  configFile          (string)     Target config file name
  sections            (object)     Grouped settings
    [SectionId]
      label           (i18n)       Section header text
      collapsed?      (bool)       Section starts folded (1.1+)
      enableKey?      (string)     Key that toggles this section
      keys            (object)     Settings in this section
        [KeyName]
          type         (string)    "bool" | "int" | "float" | "select" | "text" | "color" (1.1) | "keybind" (1.1)
          default?     (any)       Default value — also drives the hover ↺ reset button
          label        (i18n)      Display name
          description? (i18n)      Help text below the label
          min?         (number)    Minimum value (int/float only)
          max?         (number)    Maximum value (int/float only)
          step?        (number)    Increment step (float only)
          options?     (array)     Select choices, value shown on buttons (select only)
          showWhen?    (object)    Conditional visibility
          openPath?    (object)    Jump-to-file button { path, relativeTo, action }
```

---

## Field Reference

### `configFile`

**Required.** The config file this schema describes. Must be in the same directory.

```json
{ "configFile": "config.lua" }
```

### `sections`

**Required.** Groups keys under collapsible section headers. Each key in `sections` is a
unique section ID (used internally, not displayed).

```json
{
  "sections": {
    "Combat": { ... },
    "Farming": { ... }
  }
}
```

### Section → `label`

**Required.** Multi-language display name for the section header.

```json
{
  "label": { "en": "Combat", "zh-TW": "戰鬥", "ja": "戦闘" }
}
```

### Section → `collapsed` (1.1+)

**Optional.** When `true`, the section starts folded — only the header is visible until
the user clicks it to expand. Use this for "Advanced" or "Preview" groups so the editor
isn't overwhelming on first open.

```json
{
  "Advanced": {
    "label": { "en": "Advanced", "zh-TW": "進階設定" },
    "collapsed": true,
    "keys": { ... }
  }
}
```

Notes:
- Open/closed state is per-modal-mount; closing the editor and re-opening returns to the
  schema-declared default. The author's choice of "what to hide first" wins each time.
- Avoid combining `collapsed: true` with `enableKey` — the master toggle becomes invisible.

### Section → `enableKey`

**Optional.** Names a `bool` key within this section that acts as a master toggle.
When the key is `false`, all other keys in the section appear dimmed / disabled.

```json
{
  "enableKey": "Enabled",
  "keys": {
    "Enabled": { "type": "bool", "default": true, ... },
    "Speed": { "type": "int", "default": 5, ... }
  }
}
```

### Key → `type`

**Required.** Determines the input widget HZMM renders.

| Type | Widget | Value format |
|:-----|:-------|:-------------|
| `"bool"` | Toggle switch | `true` / `false` |
| `"int"` | Number input | `42`, `-7` |
| `"float"` | Decimal input | `1.5`, `0.01` |
| `"select"` | Pill buttons | `"easy"`, `"hard"` |
| `"text"` | Text input | Any string |
| `"color"` (1.1+) | Hex color picker | `"#3b82f6"` |
| `"keybind"` (1.1+) | Hotkey capture | `"Ctrl+Shift+F"`, `"F6"` |

### Key → `default`

**Optional.** The default value. Two purposes:

1. Documents the "expected" value for readers of the schema.
2. **Powers the hover ↺ reset button** — when the current value differs from `default`,
   hovering the row reveals a small reset icon that restores it. Keys with no `default`
   get no reset button.

```json
{ "type": "int", "default": 100 }
```

The reset button is purely a UI affordance; the schema field itself is unchanged from 1.0.

### Key → `label`

**Required.** Multi-language display name shown next to the input.

```json
{ "label": { "en": "Max Health", "zh-TW": "最大生命值" } }
```

### Key → `description`

**Optional.** Multi-language help text shown below the label in smaller font.

```json
{ "description": { "en": "Player maximum HP (1-9999)", "zh-TW": "玩家最大血量 (1-9999)" } }
```

### Key → `min` / `max`

**Optional.** For `int` and `float` types. HZMM validates input and clamps values on blur.

```json
{ "type": "int", "min": 1, "max": 9999 }
```

### Key → `step`

**Optional.** For `float` type. Hint for the increment when using arrow keys or spinner.

```json
{ "type": "float", "min": 0.1, "max": 10.0, "step": 0.1 }
```

### Key → `options`

**Required for `select` type.** Array of selectable values. HZMM displays the raw `value`
on buttons — use clear, readable value names.

```json
{
  "type": "select",
  "options": [
    { "value": "Easy" },
    { "value": "Normal" },
    { "value": "Hard" }
  ]
}
```

> **Note:** Buttons always show the `value` string directly. Translated descriptions
> should go in the key's `label` and `description` fields, not on individual options.

### Key → `showWhen`

**Optional.** Conditionally show this key only when another key has a specific value.
When the condition is not met, the key is hidden or dimmed.

```json
{
  "MultiplierValue": {
    "type": "float",
    "showWhen": { "Mode": "Multiplier" }
  },
  "FixedValue": {
    "type": "float",
    "showWhen": { "Mode": "Fixed" }
  }
}
```

Multiple conditions (AND logic):

```json
{ "showWhen": { "Enabled": "true", "Mode": "Advanced" } }
```

### Key → `openPath`

**Optional.** Add a small "jump to file" button next to the entry. Handy for
things like a Debug toggle where the user probably wants one-click access to
the log file it writes.

```json
{
  "Debug": {
    "type": "bool",
    "label": { "en": "Enable Debug Logs" },
    "openPath": {
      "path": "HumanitZ/Binaries/Win64/ue4ss/UE4SS.log",
      "relativeTo": "game",
      "action": "open"
    }
  }
}
```

| Field | Values | Default | Description |
|-------|--------|---------|-------------|
| `path` | string | (required) | Relative path under the chosen base |
| `relativeTo` | `"game"` \| `"mod"` | `"game"` | `"game"` resolves under the HumanitZ install root. `"mod"` resolves under the mod's own folder (`ue4ss/Mods/<modName>/`). |
| `action` | `"open"` \| `"reveal"` | `"open"` | `"open"` launches the file with the OS default program. `"reveal"` opens the containing folder with the file highlighted. |

Main-process security: the path is resolved with `resolveWithin(base, path)`,
so `..` segments that escape the chosen base are blocked. If the file doesn't
exist, the renderer shows a toast instead of silently failing.

---

## Type Deep Dive (1.1)

### `color`

Stores a hex color string `#RRGGBB`. The picker is the OS-native color dialog,
wrapped in a glass-style swatch + hex label so it matches the rest of the editor.

```json
{
  "TitleColor": {
    "type": "color",
    "default": "#3b82f6",
    "label": { "en": "Window Title Color", "zh-TW": "視窗標題顏色" },
    "description": { "en": "Used for the BetterTrade window header", "zh-TW": "BetterTrade 視窗標題使用" }
  }
}
```

**Reading from Lua:**
```lua
-- Config.TitleColor = "#3b82f6"
local hex = Config.TitleColor:sub(2)
local r = tonumber(hex:sub(1,2), 16) / 255
local g = tonumber(hex:sub(3,4), 16) / 255
local b = tonumber(hex:sub(5,6), 16) / 255
myWidget:SetColorAndOpacity({ R = r, G = g, B = b, A = 1 })
```

The widget tolerates `#fff` (3-digit) and `3b82f6` (no `#`) on input but always
writes back the full `#rrggbb` form.

### `keybind`

Stores a keyboard shortcut as a `+`-joined string. Click the field, then press
the desired combo — modifiers are detected automatically. `Esc` cancels capture,
the X button clears the binding.

```json
{
  "OpenHotkey": {
    "type": "keybind",
    "default": "F6",
    "label": { "en": "Open Trade Window", "zh-TW": "開啟交易視窗" }
  }
}
```

Format examples: `"F6"`, `"Ctrl+T"`, `"Ctrl+Shift+F"`, `"Alt+1"`, `"Meta+,"`.

**Reading from Lua (with UE4SS `RegisterKeyBind`):**
```lua
-- Config.OpenHotkey = "Ctrl+Shift+F"
local parts = {}
for p in string.gmatch(Config.OpenHotkey, "[^+]+") do table.insert(parts, p) end
local mainKey = Key[table.remove(parts):upper()]
local mods = {}
for _, m in ipairs(parts) do
  if m == "Ctrl" then table.insert(mods, ModifierKey.CONTROL)
  elseif m == "Shift" then table.insert(mods, ModifierKey.SHIFT)
  elseif m == "Alt" then table.insert(mods, ModifierKey.ALT)
  end
end
RegisterKeyBind(mainKey, mods, function() openTradeUI() end)
```

---

## Multi-Language (i18n)

All `label`, `description`, and option `label` fields use the same i18n object format:

```json
{ "en": "English text", "zh-TW": "繁體中文", "ja": "日本語" }
```

### Supported Language Codes

| Code | Language |
|:-----|:---------|
| `en` | English |
| `zh-TW` | 繁體中文 |
| `ja` | 日本語 |
| `ko` | 한국어 |
| `ru` | Русский |
| `de` | Deutsch |
| `fr` | Francais |

### Resolution Order

1. Exact match for current app language
2. `en` (English fallback)
3. First available language in the object

> **Tip:** You don't need all 7 languages. English + your native language is enough.

---

## Full Example

A complete `hzmm.config.json` demonstrating all features (1.0 + 1.1):

```json
{
  "configFile": "config.lua",
  "sections": {
    "General": {
      "label": { "en": "General", "zh-TW": "一般" },
      "keys": {
        "ModEnabled": {
          "type": "bool",
          "default": true,
          "label": { "en": "Mod Enabled", "zh-TW": "啟用模組" },
          "description": { "en": "Master switch for this mod", "zh-TW": "模組總開關" }
        }
      }
    },
    "Combat": {
      "label": { "en": "Combat", "zh-TW": "戰鬥" },
      "keys": {
        "MaxHealth": {
          "type": "int",
          "default": 100,
          "min": 1,
          "max": 9999,
          "label": { "en": "Max Health", "zh-TW": "最大生命值" },
          "description": { "en": "Maximum player health", "zh-TW": "玩家最大血量" }
        },
        "DamageMultiplier": {
          "type": "float",
          "default": 1.0,
          "min": 0.1,
          "max": 10.0,
          "step": 0.1,
          "label": { "en": "Damage Multiplier", "zh-TW": "傷害倍率" }
        },
        "Difficulty": {
          "type": "select",
          "default": "normal",
          "label": { "en": "Difficulty", "zh-TW": "難度" },
          "options": [
            { "value": "Easy" },
            { "value": "Normal" },
            { "value": "Hard" }
          ]
        }
      }
    },
    "Appearance": {
      "label": { "en": "Appearance", "zh-TW": "外觀" },
      "keys": {
        "AccentColor": {
          "type": "color",
          "default": "#3b82f6",
          "label": { "en": "Accent Color", "zh-TW": "強調色" }
        },
        "OpenHotkey": {
          "type": "keybind",
          "default": "F6",
          "label": { "en": "Toggle Hotkey", "zh-TW": "切換熱鍵" }
        }
      }
    },
    "Advanced": {
      "label": { "en": "Advanced", "zh-TW": "進階" },
      "collapsed": true,
      "keys": {
        "TickRate": {
          "type": "int",
          "default": 60,
          "min": 1,
          "max": 240,
          "label": { "en": "Tick Rate", "zh-TW": "更新頻率" },
          "description": { "en": "Updates per second — only change if you know why", "zh-TW": "每秒更新次數 — 不確定就別改" }
        },
        "DebugLogs": {
          "type": "bool",
          "default": false,
          "label": { "en": "Enable Debug Logs" },
          "openPath": {
            "path": "HumanitZ/Binaries/Win64/ue4ss/UE4SS.log",
            "relativeTo": "game",
            "action": "open"
          }
        }
      }
    }
  }
}
```

---

## Rules

1. **Key names must match exactly** between `hzmm.config.json` and `config.lua`
2. **`configFile` is required** and must point to an existing file in the same directory
3. **At least one section** with at least one key is required
4. **`type` and `label` are required** for every key
5. **`options` is required** when `type` is `"select"`
6. **`en` is recommended** as the fallback language in all i18n objects
7. **Order matters** — keys render in the order they appear in the JSON
8. **No decorative elements** — schema is for editable settings only. Static text,
   external links, version history, mod credits → put those in the mod's README, not here.

---

*This standard is maintained by the HZMM project.*
