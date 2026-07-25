// Mod config file parser / serializer.
//
// Supports INI, Lua, and hybrid formats. The parser emits a flat list of
// "entries" (keyval / comment / section / blank / lua_structure) that
// preserves enough of the original formatting to round-trip unmodified
// lines verbatim on serialize. That's intentional — config files often
// come from mod authors who care about whitespace, decoration, and inline
// comments, and the ConfigEditor UI only mutates `keyval.value`.
//
// Extracted from ConfigEditorModal.jsx as part of the 672-line split.

// A "user-editable" config file: not the mod's entry-point main.lua and not an
// internal scripts/ file. Shared by ModDetailModal (decides whether to show the
// "Edit config" button) and ConfigEditorModal (which files to load) so the two
// can't drift.
export function isUserConfigFile(f) {
  return (
    f.name.toLowerCase() !== 'main.lua' &&
    !f.relativePath.toLowerCase().startsWith('scripts/')
  );
}

// i18n helper: resolve localized string from { en: "...", "zh-TW": "..." } objects
export function resolveI18n(obj, lang) {
  if (!obj || typeof obj === 'string') return obj || '';
  return obj[lang] || obj['en'] || Object.values(obj)[0] || '';
}

// Find index of inline Lua `-- comment` while skipping content inside
// quoted strings. Returns -1 if no inline comment present. Mirrors the
// original `/(\s+--\s*.*)$/` semantics: requires whitespace before `--`.
function findInlineCommentStart(s) {
  let inQuote = false;
  let quoteChar = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      if (c === '\\' && i + 1 < s.length) { i++; continue; }
      if (c === quoteChar) { inQuote = false; quoteChar = null; }
    } else {
      if (c === '"' || c === "'") { inQuote = true; quoteChar = c; }
      else if ((c === ' ' || c === '\t') && s[i + 1] === '-' && s[i + 2] === '-') {
        return i;
      }
    }
  }
  return -1;
}

// 統一解析 config 檔案（支援 INI / Lua / 混合格式）
export function parseConfigFile(text) {
  const lines = text.split('\n');
  const entries = [];
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // 空行
    if (trimmed === '') { entries.push({ type: 'blank', raw: line }); continue; }

    // Lua block comment --[[ ... ]]
    if (trimmed.includes('--[[') && !inBlockComment) {
      const openIdx = trimmed.indexOf('--[[');
      const closeIdx = trimmed.indexOf(']]', openIdx + 4);
      if (closeIdx !== -1) {
        // 單行 block comment — 嘗試提取 section 名稱 --[[▓▓[ NAME ]▓▓--]]
        const inner = trimmed.slice(openIdx + 4, closeIdx);
        const secMatch = inner.match(/\[\s*(.+?)\s*\]/);
        if (secMatch) {
          const name = secMatch[1].replace(/\s*[-–—]\s*\(.+\)\s*$/, '').trim();
          // decorative: comment banners group keys visually but don't create a
          // real scope — Lua table keys all share one flat namespace.
          entries.push({ type: 'section', raw: line, name, decorative: true });
        } else {
          entries.push({ type: 'comment', raw: line, text: '' });
        }
        continue;
      }
      inBlockComment = true;
      entries.push({ type: 'comment', raw: line, text: '' });
      continue;
    }
    if (inBlockComment) { if (trimmed.includes(']]')) inBlockComment = false; entries.push({ type: 'comment', raw: line, text: '' }); continue; }

    // 各種單行註解（-- ; # //）
    if (trimmed.startsWith('--') || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      let commentBody = trimmed.replace(/^(--|;|#|\/\/)\s*/, '');
      // 偵測 section header: -- ====[ NAME ]==== 或 # ====[ NAME ]====
      const secInComment = commentBody.match(/^\W*\[\s*(.+?)\s*\]\W*$/);
      if (secInComment) {
        const name = secInComment[1].replace(/\s*[-–—]\s*\(.+\)\s*$/, '').trim();
        // decorative: see block-comment branch above — comment headers are
        // visual grouping only, not a key scope.
        entries.push({ type: 'section', raw: line, name, decorative: true });
        continue;
      }
      // 分隔線、裝飾線、純符號行 → 不顯示文字
      const isDecorative = /^[=\-~*.#[\](){}<>/\\|_\s]+$/.test(commentBody) || commentBody.startsWith('=') || commentBody === '';
      entries.push({ type: 'comment', raw: line, text: isDecorative ? '' : commentBody });
      continue;
    }

    // Lua 結構語法（local X = {, }, return X）
    if (trimmed.match(/^local\s+\w+\s*=\s*\{/) || trimmed === '{' || trimmed === '}' || trimmed.match(/^return\s+\w/)) {
      entries.push({ type: 'lua_structure', raw: line }); continue;
    }

    // INI section [SectionName]
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      entries.push({ type: 'section', raw: line, name: trimmed.slice(1, -1) }); continue;
    }

    // key = value（通用，支援 INI 和 Lua）
    // 抓等號後「整段」原始值，再依序拆 inline comment → 尾逗號 → 引號。
    // 順序很重要：先拆註解才能正確判斷逗號與引號，否則像
    // `Name = "AK47", -- gun` 會把逗號/引號留在 value 裡，round-trip 損壞。
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (kvMatch) {
      let value = kvMatch[2].trim();

      // 1. 先提取行內註解 (-- comment)。findInlineCommentStart 會 skip 引號
      //    內部（避免 `Desc = "TODO -- fix"` 被誤切），並回傳 `--` 前空白的
      //    位置，故 trailing 自帶一個前導空白、round-trip 不掉格式。
      let inlineDesc = null;
      let trailing = '';
      let hadComma = false;
      const dashIdx = findInlineCommentStart(value);
      if (dashIdx !== -1) {
        trailing = value.slice(dashIdx);
        value = value.slice(0, dashIdx).trim();
        const descText = trailing.replace(/^.*?--\s*/, '').trim();
        inlineDesc = descText.replace(/^\d+\s*[-–—]\s*/, '').trim() || null;
      }

      // 2. 再去尾逗號（Lua 慣例），記錄 hadComma 以便存回時還原。
      if (value.endsWith(',')) {
        value = value.slice(0, -1).trim();
        hadComma = true;
      }

      // 3. 最後判斷引號、取裸值。
      const isQuoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
      const bareValue = isQuoted ? value.slice(1, -1) : value;
      // Capture the original quote char (' vs ") and the parsed value so
      // serialize can (a) emit an UNMODIFIED line verbatim from `raw` — keeping
      // its exact spacing / CRLF / quote style — and (b) preserve single quotes
      // when a modified line must be rebuilt.
      const quoteChar = isQuoted ? value[0] : null;
      // 有尾逗號或塊註解 → 視為 Lua 格式。
      const isLua = hadComma || text.includes('--[[');
      entries.push({ type: 'keyval', raw: line, key: kvMatch[1], value: bareValue, origValue: bareValue, isQuoted, quoteChar, format: isLua ? 'lua' : 'ini', inlineDesc, trailing, hadComma });
      continue;
    }

    // 其他 → 當註解處理
    entries.push({ type: 'comment', raw: line, text: '' });
  }
  return entries;
}

// 將結構化資料轉回文字
export function serializeConfig(entries) {
  return entries.map((e) => {
    if (e.type === 'keyval') {
      // Untouched parsed line → emit `raw` verbatim. This preserves the exact
      // original formatting (spacing around `=`, single vs double quotes, and a
      // trailing `\r` on CRLF files) instead of reconstructing — reconstruction
      // is only needed for lines the user actually edited.
      if (e.origValue !== undefined && e.value === e.origValue) return e.raw;
      const indent = e.raw.match(/^(\s*)/)?.[1] || '';
      // Preserve the original quote char when rebuilding a modified line.
      const q = e.quoteChar || '"';
      const val = e.isQuoted ? `${q}${e.value}${q}` : e.value;
      // 從 parse 時記錄的 hadComma 還原尾逗號 — 不能再靠 e.raw 結尾判斷，
      // 因為有 inline comment 時原始行結尾是註解而非逗號（會誤掉逗號）。
      const comma = e.hadComma ? ',' : '';
      const trail = e.trailing || '';
      // Keep the line's original EOL: on a CRLF file, `line.trim()` stripped the
      // `\r` before parsing, so re-append it here or the rebuilt keyval line
      // would be LF-only while surrounding comment/blank lines stay CRLF.
      const cr = /\r$/.test(e.raw || '') ? '\r' : '';
      return `${indent}${e.key} = ${val}${comma}${trail}${cr}`;
    }
    return e.raw;
  }).join('\n');
}

// Build the sectionName → keyName → entryIndex lookup for the schema renderer.
// `hasStructuredSections` is true only when the file has a REAL section marker
// (an INI `[Section]` line). Decorative comment banners (`-- ====[ NAME ]====`,
// parsed with `decorative: true`) still bucket keys — schemas whose section ids
// match the banner names resolve via the exact hit — but they must NOT flip the
// file to "structured": Lua table keys share one flat namespace, and banner
// names rarely equal schema section ids (e.g. banner "UPGRADE STORAGE EXTRA
// CAPACITY" vs schema id "UpgradeStorage"). Treating banners as scopes made
// every key lookup miss and the editor rendered an empty schema.
export function buildSectionKeyIndex(entries) {
  const keyIndexMap = {};
  let currentSection = '';
  let hasStructuredSections = false;
  entries.forEach((e, i) => {
    if (e.type === 'section') {
      currentSection = e.name || '';
      if (!e.decorative) hasStructuredSections = true;
    } else if (e.type === 'keyval') {
      if (!keyIndexMap[currentSection]) keyIndexMap[currentSection] = {};
      keyIndexMap[currentSection][e.key] = i;
    }
  });
  return { keyIndexMap, hasStructuredSections };
}

// Section names are compared case- and punctuation-insensitively, because a
// decorative banner is prose ("UPGRADE STORAGE EXTRA CAPACITY") while a schema
// section id is an identifier ("UpgradeStorage").
const normSection = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Find the FILE's section name for a schema section id: exact, then normalized
// equality, then "the banner expands the id" prefix. A prefix hit only counts
// when exactly one banner matches — two candidates mean we can't tell them
// apart, and guessing would silently bind the row to the wrong block.
// Returns undefined when nothing matches confidently.
function matchSectionByName(keyIndexMap, sectionId) {
  if (keyIndexMap[sectionId]) return sectionId;
  const want = normSection(sectionId);
  if (!want) return undefined;
  const names = Object.keys(keyIndexMap).filter(n => n !== '');
  const exact = names.find(n => normSection(n) === want);
  if (exact !== undefined) return exact;
  const prefixed = names.filter(n => normSection(n).startsWith(want));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

// Resolve a schema (sectionId, keyName) to an entry index against the lookup
// built above. Structured (INI) configs get strict per-section scoping so a
// key name repeated under two `[Section]`s can't leak across scopes.
//
// Flat configs (no sections, or decorative banners only) try the banner whose
// name matches the schema section, then fall back to scanning every bucket —
// but ONLY when the key name is unique in the file. A key repeated under two
// banners (`Damage` under both `[ AK47 ]` and `[ M4 ]`) is ambiguous: the old
// first-hit scan bound both schema rows to the same entry, so the M4 row
// displayed AK47's value and editing it overwrote AK47's line. Unresolvable
// ambiguity returns undefined — the row is hidden rather than wired to the
// wrong line, matching how a real INI section behaves when it can't be found.
export function resolveEntryIdx({ keyIndexMap, hasStructuredSections }, sectionId, keyName) {
  const exact = keyIndexMap[sectionId]?.[keyName];
  if (exact !== undefined) return exact;
  if (hasStructuredSections) return undefined;

  const byName = matchSectionByName(keyIndexMap, sectionId);
  if (byName !== undefined && keyIndexMap[byName][keyName] !== undefined) {
    return keyIndexMap[byName][keyName];
  }

  const owners = Object.values(keyIndexMap).filter(b => b[keyName] !== undefined);
  return owners.length === 1 ? owners[0][keyName] : undefined;
}

// Map a schema section id onto the section name the file ACTUALLY uses, so
// writes land where resolveEntryIdx reads from. Needed because a decorative
// banner's text rarely equals the schema's section id ("UPGRADE STORAGE EXTRA
// CAPACITY" vs "UpgradeStorage") — appendKeyval matches section markers by
// name, so handing it the raw schema id silently missed and dumped every
// toggled-on key at the file bottom.
//
// Resolution order mirrors resolveEntryIdx so reads and writes agree: exact /
// normalized banner name first, then locate the section via one of the schema
// section's own keys. That sibling lookup only trusts a key that lives in
// exactly ONE bucket — an ambiguous key (same name under several banners)
// would otherwise point the append at whichever banner happened to come first.
// Falls back to the schema id when nothing resolves (sectionless files, or a
// section whose keys are all absent) — that's appendKeyval's existing "append
// after the last keyval" path.
export function resolveSectionName(index, sectionId, keyNames = []) {
  const { keyIndexMap, hasStructuredSections } = index;
  if (keyIndexMap[sectionId] || hasStructuredSections) return sectionId;
  const byName = matchSectionByName(keyIndexMap, sectionId);
  if (byName !== undefined) return byName;
  for (const keyName of keyNames) {
    const owners = Object.entries(keyIndexMap).filter(([, b]) => b[keyName] !== undefined);
    if (owners.length === 1) return owners[0][0];
  }
  return sectionId;
}

// 判斷值類型
export function guessValueType(val) {
  if (val === 'true' || val === 'false') return 'bool';
  if (/^-?\d+$/.test(val)) return 'int';
  if (/^-?\d+\.\d+$/.test(val)) return 'float';
  return 'string';
}

// Insert a new keyval entry into an existing entries list. Used by the
// schema-1.2 optional widget when the user toggles a key on — we have to
// add a real entry so the value gets serialized back to config.lua.
//
// Placement strategy:
//   - If `sectionHint` is provided AND the parsed entries contain a
//     matching `type: 'section'` marker (e.g. a `-- [BP_AK47Rifle]`
//     comment), insert the new entry inside that section, right after
//     the section's last keyval (or at the section start if it had
//     none yet). This keeps related keys grouped — without it, a user
//     toggling on AK47.Damage gets the new line dumped at the file
//     bottom instead of inside the BP_AK47Rifle block.
//   - Otherwise: insert after the file's last keyval, falling back to
//     just-before-closing-brace, falling back to end.
//
// `value` is always coerced to string because the rest of the editor
// stores entry values as strings.
export function appendKeyval(entries, key, value, options = {}) {
  const { isQuoted = false, format = 'lua', sectionHint = null } = options;
  const valueStr = String(value);
  const literal = isQuoted ? `"${valueStr}"` : valueStr;
  const trailingComma = format === 'lua' ? ',' : '';
  const newEntry = {
    type: 'keyval',
    raw: `${key} = ${literal}${trailingComma}`,
    key,
    value: valueStr,
    isQuoted,
    format,
    // serialize 改用 hadComma 還原逗號，故新增 entry 也要設（lua → 有逗號）。
    hadComma: format === 'lua',
    inlineDesc: null,
    trailing: '',
  };

  let insertIdx = -1;

  if (sectionHint) {
    // Find the section marker matching the hint.
    let sectionStart = -1;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].type === 'section' && entries[i].name === sectionHint) {
        sectionStart = i;
        break;
      }
    }
    if (sectionStart !== -1) {
      // Find where this section ends — at the next section marker, or
      // at the closing `}` of the table, whichever comes first.
      let sectionEnd = entries.length;
      for (let i = sectionStart + 1; i < entries.length; i++) {
        const e = entries[i];
        if (e.type === 'section') { sectionEnd = i; break; }
        if (e.type === 'lua_structure' && e.raw.trim() === '}') { sectionEnd = i; break; }
      }
      // Insert after the section's last keyval, otherwise immediately
      // after the section header.
      for (let i = sectionEnd - 1; i > sectionStart; i--) {
        if (entries[i].type === 'keyval') { insertIdx = i + 1; break; }
      }
      if (insertIdx === -1) insertIdx = sectionStart + 1;
    }
  }

  if (insertIdx === -1) {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].type === 'keyval') { insertIdx = i + 1; break; }
    }
  }
  if (insertIdx === -1) {
    const closeIdx = entries.findIndex(e => e.type === 'lua_structure' && e.raw.trim() === '}');
    insertIdx = closeIdx !== -1 ? closeIdx : entries.length;
  }

  // Inherit indentation from the nearest preceding line so the new
  // line visually slots in. Without this the new key looks like an
  // outdented stranger next to its 2-space-indented siblings.
  let indent = '';
  for (let i = insertIdx - 1; i >= 0; i--) {
    const prev = entries[i];
    if (prev.type === 'blank') continue;
    const m = (prev.raw || '').match(/^([ \t]+)/);
    if (m) indent = m[1];
    break;
  }
  if (indent) newEntry.raw = `${indent}${newEntry.raw}`;

  return [...entries.slice(0, insertIdx), newEntry, ...entries.slice(insertIdx)];
}

// Remove a single keyval entry by index — the exact index resolveEntryIdx
// handed the row that's being toggled off. Index-based on purpose: the old
// (key, sectionHint) filter re-derived the target by matching the schema's
// section id against the file's section names, which never matched for
// decorative banners, so toggling an optional key off silently did nothing.
// Resolution now happens once, in resolveEntryIdx, and both read and write
// use its answer.
export function removeKeyvalAt(entries, idx) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= entries.length) return entries;
  if (entries[idx].type !== 'keyval') return entries;
  return [...entries.slice(0, idx), ...entries.slice(idx + 1)];
}

// Remove keyval entries with the given key. When `sectionHint` is provided,
// only entries inside that section are removed — needed when the schema has
// the same key name under multiple sections (a flat key filter would also
// drop the unrelated sibling entries). Without `sectionHint`, falls back to
// flat removal for backwards-compat with sectionless config.lua schemas.
export function removeKeyval(entries, key, sectionHint = null) {
  if (!sectionHint) {
    return entries.filter(e => !(e.type === 'keyval' && e.key === key));
  }
  // If the file has no section marker matching the hint — the common case where
  // a schema groups keys under named sections but config.lua is flat (every key
  // lives in the '' bucket) — there's nothing to scope removal to. Fall back to
  // flat removal, otherwise the optional-key toggle-off silently does nothing.
  const hasMatchingSection = entries.some(e => e.type === 'section' && (e.name || '') === sectionHint);
  if (!hasMatchingSection) {
    return entries.filter(e => !(e.type === 'keyval' && e.key === key));
  }
  let currentSection = '';
  return entries.filter(e => {
    if (e.type === 'section') { currentSection = e.name || ''; return true; }
    if (e.type === 'keyval' && e.key === key && currentSection === sectionHint) return false;
    return true;
  });
}

// Decide whether a value of the given schema type should be quoted when
// serialized back into Lua. Numbers / bools / array-literals stay bare;
// everything textual (color, keybind, generic strings) gets double-quoted.
export function valueNeedsQuote(type) {
  return type === 'string' || type === 'text' || type === 'color' || type === 'keybind';
}

// A close-quote is escaped only when preceded by an odd number of
// backslashes. Single-char lookback (`s[i-1] !== '\\'`) wrongly treats
// `\\"` (literal backslash + close quote) as escaped → merges items.
function isQuoteEscaped(s, idx) {
  let count = 0;
  for (let j = idx - 1; j >= 0 && s[j] === '\\'; j--) count++;
  return count % 2 === 1;
}

// Parse a Lua-style array literal like `{"a", "b", "c"}` into a JS string
// array. Returns null when the input doesn't look like an array literal,
// so callers can distinguish "empty list" from "not a list at all".
//
// Quote-aware split (so commas inside strings don't break the parse).
// Doesn't try to handle nested tables — multi-select / list widgets are
// flat string arrays by design.
export function parseLuaArray(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner === '') return [];
  const items = [];
  let current = '';
  let inQuote = false;
  let quoteChar = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (!inQuote && (c === '"' || c === "'")) { inQuote = true; quoteChar = c; current += c; }
    else if (inQuote && c === quoteChar && !isQuoteEscaped(inner, i)) { inQuote = false; quoteChar = null; current += c; }
    else if (!inQuote && c === ',') { items.push(current.trim()); current = ''; }
    else current += c;
  }
  if (current.trim() !== '') items.push(current.trim());
  return items.map(raw => {
    const t = raw.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      return unescapeLuaString(t.slice(1, -1));
    }
    return t;
  });
}

// Single-pass unescape for the subset of Lua escape sequences we emit:
// `\\` → `\`, `\"` → `"`, `\'` → `'`. Anything else stays literal.
function unescapeLuaString(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === '\\' || next === '"' || next === "'") { out += next; i++; continue; }
    }
    out += s[i];
  }
  return out;
}

// Serialize a JS string array back into a Lua array literal. Always
// double-quotes each item and escapes inner quotes. Empty array becomes
// `{}`.
export function serializeLuaArray(arr) {
  if (!Array.isArray(arr)) return '{}';
  if (arr.length === 0) return '{}';
  // Escape backslash BEFORE quote so `\` → `\\` doesn't double-escape the
  // quote we just wrote. Pair with parseLuaArray's escape-aware close-quote
  // detection so values containing `\` round-trip cleanly.
  return '{' + arr.map(s => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(', ') + '}';
}
