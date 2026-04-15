# HZMM Config Schema Standard

> `hzmm.config.json` specification for mod authors who want rich UI in HZMM's config editor.
>
> Version: **1.0** | Supported: HZMM v1.3.0+

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
      enableKey?      (string)     Key that toggles this section
      keys            (object)     Settings in this section
        [KeyName]
          type         (string)    "bool" | "int" | "float" | "select" | "text"
          default?     (any)       Default value for reset
          label        (i18n)      Display name
          description? (i18n)      Help text below the label
          min?         (number)    Minimum value (int/float only)
          max?         (number)    Maximum value (int/float only)
          step?        (number)    Increment step (float only)
          options?     (array)     Select choices, value shown on buttons (select only)
          showWhen?    (object)    Conditional visibility
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

### Key → `default`

**Optional.** The default value. Enables a per-key "reset to default" action.

```json
{ "type": "int", "default": 100 }
```

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

**Optional.** For `int` and `float` types. HZMM validates input and clamps values.

```json
{ "type": "int", "min": 1, "max": 9999 }
```

### Key → `step`

**Optional.** For `float` type. Defines the increment when using arrow keys or spinner.

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

A complete `hzmm.config.json` demonstrating all features:

```json
{
  "configFile": "config.lua",
  "sections": {
    "General": {
      "label": { "en": "General", "zh-TW": "一般", "ja": "一般" },
      "keys": {
        "ModEnabled": {
          "type": "bool",
          "default": true,
          "label": { "en": "Mod Enabled", "zh-TW": "啟用模組", "ja": "MOD有効化" },
          "description": { "en": "Master switch for this mod", "zh-TW": "模組總開關" }
        }
      }
    },
    "Combat": {
      "label": { "en": "Combat", "zh-TW": "戰鬥", "ja": "戦闘" },
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
          "label": { "en": "Damage Multiplier", "zh-TW": "傷害倍率" },
          "description": { "en": "Applied to all attacks", "zh-TW": "所有攻擊的傷害倍率" }
        },
        "Difficulty": {
          "type": "select",
          "default": "normal",
          "label": { "en": "Difficulty", "zh-TW": "難度" },
          "description": { "en": "Game difficulty preset", "zh-TW": "遊戲難度預設" },
          "options": [
            { "value": "Easy" },
            { "value": "Normal" },
            { "value": "Hard" },
            { "value": "Nightmare" }
          ]
        }
      }
    },
    "Farming": {
      "label": { "en": "Farming", "zh-TW": "農耕" },
      "enableKey": "Enabled",
      "keys": {
        "Enabled": {
          "type": "bool",
          "default": true,
          "label": { "en": "Enable Farming", "zh-TW": "啟用農耕" },
          "description": { "en": "Toggle the entire farming system", "zh-TW": "開關整個農耕系統" }
        },
        "CropGrowthHours": {
          "type": "int",
          "default": 24,
          "min": 1,
          "max": 720,
          "label": { "en": "Growth Time", "zh-TW": "生長時間" },
          "description": { "en": "Hours for crops to fully grow", "zh-TW": "作物完全生長所需時數" }
        },
        "FertilizerType": {
          "type": "select",
          "default": "none",
          "label": { "en": "Fertilizer", "zh-TW": "肥料類型" },
          "options": [
            { "value": "None" },
            { "value": "Basic (+25%)" },
            { "value": "Advanced (+50%)" }
          ]
        }
      }
    },
    "Radius": {
      "label": { "en": "Generator Radius", "zh-TW": "發電機範圍" },
      "keys": {
        "Mode": {
          "type": "select",
          "default": "Multiplier",
          "label": { "en": "Radius Mode", "zh-TW": "範圍模式" },
          "options": [
            { "value": "Multiplier" },
            { "value": "Fixed" }
          ]
        },
        "MultiplierValue": {
          "type": "float",
          "default": 3.0,
          "min": 0.1,
          "max": 50.0,
          "label": { "en": "Radius Multiplier", "zh-TW": "範圍倍率" },
          "showWhen": { "Mode": "Multiplier" }
        },
        "FixedValue": {
          "type": "float",
          "default": 1800.0,
          "min": 100,
          "max": 50000,
          "label": { "en": "Fixed Radius", "zh-TW": "固定範圍" },
          "showWhen": { "Mode": "Fixed" }
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

---

*This standard is maintained by the HZMM project.*
