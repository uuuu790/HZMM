# HZMM Config Standard

> Specification for mod authors to write configs that integrate with HZMM's visual editor.
>
> Version: **1.0** | Supported: HZMM v1.2.9+

---

## At a Glance

HZMM reads your existing config files (`.lua`, `.ini`, `.cfg`, etc.) and renders them
as a visual editor with toggles, selectors, and inputs. All metadata is driven by
**comments** — no extra schema files needed.

```lua
--[[ ====[ COMBAT SETTINGS ]==== ]]

-- MaxHealth - Maximum player health
-- MaxHealth.zh-TW - 玩家最大血量
-- MaxHealth.ja - プレイヤーの最大HP
MaxHealth = 100,

-- EnablePvP - Enable player vs player damage
-- EnablePvP.zh-TW - 啟用玩家對戰傷害
EnablePvP = true,

-- DamageMultiplier - Damage scale (decimal)
-- DamageMultiplier.zh-TW - 傷害倍率
DamageMultiplier = 1.5,
```

**Result in HZMM:**

| Key              | Type  | Description (follows app language) |
|:-----------------|:------|:-----------------------------------|
| MaxHealth        | `INT` | 玩家最大血量 *(when app is zh-TW)* |
| EnablePvP        | `ON/OFF` | 啟用玩家對戰傷害                 |
| DamageMultiplier | `FLOAT` | 傷害倍率                          |

---

## Table of Contents

1. [Supported File Formats](#1-supported-file-formats)
2. [Key-Value Syntax](#2-key-value-syntax)
3. [Sections](#3-sections)
4. [Descriptions (Single Language)](#4-descriptions-single-language)
5. [Multi-Language Descriptions](#5-multi-language-descriptions)
6. [Type Detection](#6-type-detection)
7. [Select Options (Enum)](#7-select-options-enum)
8. [Conditional Visibility](#8-conditional-visibility)
9. [Best Practices](#9-best-practices)
10. [Full Example](#10-full-example)

---

## 1. Supported File Formats

| Extension | Notes |
|:----------|:------|
| `.ini` `.cfg` `.conf` | Standard INI key=value |
| `.lua` | Lua table syntax (`key = value,` with trailing comma) |
| `.json` | JSON objects |
| `.toml` | TOML format |
| `.yaml` `.yml` | YAML format |
| `.xml` | XML format |
| `.txt` | Only if filename contains **"config"** (e.g. `config.txt`) |

> **Note:** For `.lua` and `.txt` files, the filename **must** contain "config" to be
> discovered by HZMM (e.g. `config.lua`, `MyModConfig.txt`). Other extensions are
> discovered automatically.

### Excluded Files

These files are always skipped:

- `main.lua` — mod entry point
- `enabled.txt` — HZMM enable/disable flag
- `_hzmm_link.json` — hybrid mod linking
- Anything under `Scripts/` directory

---

## 2. Key-Value Syntax

### INI Style

```ini
MyKey = some_value
BoolKey = true
NumberKey = 42
```

### Lua Style

```lua
local Config = {
    MyKey = "some_value",
    BoolKey = true,
    NumberKey = 42,
}
return Config
```

Both styles are fully supported and can be mixed. HZMM preserves the original format
(quotes, trailing commas, indentation) when saving.

---

## 3. Sections

Sections group related keys under a header in the editor.

### INI Sections

```ini
[Combat]
MaxHealth = 100
DamageMultiplier = 1.5

[Crafting]
CraftSpeed = 2
```

### Lua Sections (Comment-Based)

```lua
-- ====[ COMBAT ]====
MaxHealth = 100,
DamageMultiplier = 1.5,

--[[ ====[ CRAFTING ]==== ]]
CraftSpeed = 2,
```

> **Tip:** HZMM auto-hides sections that contain no key-value entries.

---

## 4. Descriptions (Single Language)

HZMM extracts descriptions from comments using several patterns, in priority order:

### Pattern A: Named Description (Recommended)

```lua
-- MaxHealth - Maximum player health
MaxHealth = 100,
```

Format: `-- KeyName - Description text` or `-- KeyName : Description text`

### Pattern B: Comment Block Above Key

```lua
-- Maximum player health, between 1 and 9999
MaxHealth = 100,
```

When no named pattern is found, HZMM uses the **topmost** comment in the
block directly above the key.

### Pattern C: Inline Comment

```lua
MaxHealth = 100, -- Maximum player health
```

### Pattern D: Comment Below Key

```lua
MaxHealth = 100,
-- Maximum player health
```

### Fallback

If no description is found, HZMM converts the key name to readable text:
`MaxPlayerHealth` becomes *"Max Player Health"*.

---

## 5. Multi-Language Descriptions

Add language-tagged comments to support HZMM's 7 languages:

```lua
-- MaxHealth - Maximum player health
-- MaxHealth.zh-TW - 玩家最大血量
-- MaxHealth.ja - プレイヤーの最大HP
-- MaxHealth.ko - 플레이어 최대 체력
-- MaxHealth.ru - Максимальное здоровье
-- MaxHealth.de - Maximale Gesundheit
-- MaxHealth.fr - Santé maximale du joueur
MaxHealth = 100,
```

**Format:** `-- KeyName.LANG_CODE - Description`

### Supported Language Codes

| Code | Language |
|:-----|:---------|
| `zh-TW` | 繁體中文 (Traditional Chinese) |
| `en` | English |
| `ja` | 日本語 (Japanese) |
| `ko` | 한국어 (Korean) |
| `ru` | Русский (Russian) |
| `de` | Deutsch (German) |
| `fr` | Français (French) |

### Resolution Order

1. `KeyName.{current_language}` — exact match for the app's current language
2. `KeyName` (no language tag) — fallback to the default description
3. Comment block / inline / below-key — standard fallback chain

> **Tip:** You don't need to translate to all 7 languages. English as the default +
> a few popular languages is enough. HZMM falls back gracefully.

---

## 6. Type Detection

HZMM auto-detects value types and renders the appropriate widget:

| Value | Detected Type | Widget |
|:------|:--------------|:-------|
| `true` / `false` | `bool` | Toggle switch |
| `42` `-7` | `int` | Numeric input |
| `1.5` `-0.3` | `float` | Decimal input |
| `"easy"` `some_text` | `string` | Text input or Select buttons |

No manual type annotation needed — HZMM infers the type from the value.

---

## 7. Select Options (Enum)

Define selectable options using `"value" : description` comments above the key:

```lua
-- "easy" : Reduced enemy damage
-- "normal" : Standard difficulty
-- "hard" : Double enemy damage
-- "nightmare" : Instant death
Difficulty = "normal",
```

HZMM renders this as a row of clickable pill buttons instead of a text input.

### Multi-Language Options

```lua
-- "easy" : Reduced damage
-- "easy".zh-TW : 降低傷害
-- "normal" : Standard
-- "normal".zh-TW : 標準
-- "hard" : Double damage
-- "hard".zh-TW : 雙倍傷害
Difficulty = "normal",
```

> **Requirement:** At least **2 options** must be defined. Single-option definitions
> are treated as regular comments.

---

## 8. Conditional Visibility

Make keys appear dimmed when a condition isn't met.

### Method A: Explicit Dependency

```lua
-- EnableFarming - Enable the farming system
EnableFarming = true,

-- Active when EnableFarming = "true"
-- CropGrowthRate - How fast crops grow (hours)
CropGrowthRate = 24,
```

When `EnableFarming` is `false`, `CropGrowthRate` appears at 30% opacity.

**Format:** `-- Active when KeyName = "value"` (exact match, case-sensitive)

### Method B: Enable Toggle (Auto-Detection)

```lua
-- ====[ FARMING ]====
EnableFarming = true,

CropGrowthRate = 24,
WaterInterval = 12,
```

Any key named `Enable*` (case-insensitive) in a section automatically controls
all other keys in the **same section**. When the enable key is `false`, all
sibling keys are dimmed.

---

## 9. Best Practices

### Do

- **Use named descriptions** (`-- KeyName - desc`) — they're the most reliable
  and support multi-language with `.lang` suffix
- **Group related keys** under section headers for better organization
- **Provide English as the default** description (no language tag), then add
  translations with language tags
- **Use meaningful key names** — `MaxPlayerHealth` is better than `mph`
- **Define options** for any key with a fixed set of valid values

### Don't

- Don't put config logic in `main.lua` — keep it in a separate `config.lua`
- Don't use deeply nested Lua tables — HZMM parses flat `key = value` pairs
- Don't rely on value order — HZMM displays keys in file order, not sorted
- Don't use the same key name in multiple sections — descriptions match by
  key name globally

### File Naming

| Recommended | Why |
|:------------|:----|
| `config.lua` | Auto-discovered, clear purpose |
| `settings.ini` | Auto-discovered |
| `MyMod_config.txt` | Contains "config" → auto-discovered |

---

## 10. Full Example

A complete `config.lua` demonstrating all features:

```lua
--[[ ============================================
     MyMod Configuration
     Modify values below, then save in HZMM.
============================================ ]]

local Config = {

--[[ ====[ GENERAL ]==== ]]

-- ModEnabled - Master toggle for this mod
-- ModEnabled.zh-TW - 模組總開關
-- ModEnabled.ja - MOD有効化
ModEnabled = true,

--[[ ====[ COMBAT ]==== ]]

-- MaxHealth - Maximum player health (1-9999)
-- MaxHealth.zh-TW - 玩家最大血量 (1-9999)
MaxHealth = 100,

-- DamageMultiplier - Damage multiplier applied to all attacks
-- DamageMultiplier.zh-TW - 所有攻擊的傷害倍率
DamageMultiplier = 1.0,

-- "easy" : Reduced enemy damage
-- "easy".zh-TW : 降低敵人傷害
-- "normal" : Standard difficulty
-- "normal".zh-TW : 標準難度
-- "hard" : Double enemy damage
-- "hard".zh-TW : 雙倍敵人傷害
-- Difficulty - Game difficulty preset
-- Difficulty.zh-TW - 遊戲難度預設
Difficulty = "normal",

--[[ ====[ FARMING ]==== ]]

-- EnableFarming - Enable the farming system
-- EnableFarming.zh-TW - 啟用農耕系統
EnableFarming = true,

-- Active when EnableFarming = "true"
-- CropGrowthRate - Hours for crops to fully grow
-- CropGrowthRate.zh-TW - 作物完全生長所需時數
CropGrowthRate = 24,

-- Active when EnableFarming = "true"
-- WaterInterval - Hours between watering
-- WaterInterval.zh-TW - 澆水間隔時數
WaterInterval = 12,

}
return Config
```

---

## Language Codes Reference

For use in `KeyName.CODE` patterns and `README.CODE.md` filenames:

```
zh-TW  繁體中文     en  English      ja  日本語
ko     한국어       ru  Русский      de  Deutsch
fr     Français
```

---

*This standard is maintained by the HZMM project. For questions or suggestions,
open an issue on GitHub.*
