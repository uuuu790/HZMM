// Small pure helpers shared by config-editor widgets. Live here (not
// inside the .jsx files) so the Vitest node-env test runner can import
// them without needing a JSX transform.

import { serializeLuaArray } from './config-parser';

// Serialize a schema-declared `default` into the same string form we store
// in `entries[].value`. Shared by ConfigEditorModal (reset handler + the
// "already at default?" check) and SchemaRenderer (per-row reset target,
// optional-key seed) so the two never diverge. Array defaults (list /
// multi-select) MUST go through serializeLuaArray so they round-trip through
// parseLuaArray — a bare String(["Fire","Ice"]) would write broken Lua.
// Floats keep at least one decimal so 3.0 doesn't degrade to "3".
export function defaultToValueStr(keyDef) {
  if (!keyDef || keyDef.default === undefined || keyDef.default === null) return null;
  if (Array.isArray(keyDef.default)) return serializeLuaArray(keyDef.default);
  if (keyDef.type === 'float' && typeof keyDef.default === 'number' && Number.isInteger(keyDef.default)) {
    return keyDef.default.toFixed(1);
  }
  return String(keyDef.default);
}

// Type-appropriate seed for optional keys lacking a schema default.
// Strings/color/keybind serialize quoted (`key = "",`) so empty is fine.
// Numbers/bools/lists serialize bare — empty would emit `key = ,` which
// is a Lua syntax error.
export function typedDefaultSeed(type) {
  switch (type) {
    case 'bool': return 'false';
    case 'int': return '0';
    case 'float': return '0.0';
    case 'list':
    case 'multi-select': return '{}';
    default: return '';
  }
}

// Map e.code (physical key identifier) to the bound key name. Using
// e.key would record Shift+1 as "Shift+!" on US layouts and produce
// locale-specific characters on non-US keyboards. Physical key names
// stay stable across layouts.
export function codeToMainKey(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);   // KeyA → A
  if (/^Digit[0-9]$/.test(code)) return code.slice(5); // Digit1 → 1
  return code;                                          // F6, ArrowUp, Space, …
}
