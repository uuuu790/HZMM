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

// i18n helper: resolve localized string from { en: "...", "zh-TW": "..." } objects
export function resolveI18n(obj, lang) {
  if (!obj || typeof obj === 'string') return obj || '';
  return obj[lang] || obj['en'] || Object.values(obj)[0] || '';
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
          entries.push({ type: 'section', raw: line, name });
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
        entries.push({ type: 'section', raw: line, name });
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
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+?),?\s*$/);
    if (kvMatch) {
      let value = kvMatch[2].trim();
      if (value.endsWith(',')) value = value.slice(0, -1).trim();

      // 提取行內註解 (-- comment)，保留原始尾段以便存回
      let inlineDesc = null;
      let trailing = '';
      const dashMatch = value.match(/^(.+?)(\s+--\s*.*)$/);
      if (dashMatch) {
        value = dashMatch[1].trim();
        trailing = dashMatch[2];
        const descText = dashMatch[2].replace(/^.*--\s*/, '').trim();
        inlineDesc = descText.replace(/^\d+\s*[-–—]\s*/, '').trim() || null;
      }

      // 去掉引號取裸值
      const isQuoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
      const bareValue = isQuoted ? value.slice(1, -1) : value;
      // 判斷原始格式（有逗號結尾或在 Lua 結構內 → lua）
      const isLua = line.match(/,\s*$/) || text.includes('--[[');
      entries.push({ type: 'keyval', raw: line, key: kvMatch[1], value: bareValue, isQuoted, format: isLua ? 'lua' : 'ini', inlineDesc, trailing });
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
      const indent = e.raw.match(/^(\s*)/)?.[1] || '';
      const val = e.isQuoted ? `"${e.value}"` : e.value;
      const comma = e.format === 'lua' && e.raw.match(/,\s*$/) ? ',' : '';
      const trail = e.trailing || '';
      return `${indent}${e.key} = ${val}${comma}${trail}`;
    }
    return e.raw;
  }).join('\n');
}

// 判斷值類型
export function guessValueType(val) {
  if (val === 'true' || val === 'false') return 'bool';
  if (/^-?\d+$/.test(val)) return 'int';
  if (/^-?\d+\.\d+$/.test(val)) return 'float';
  return 'string';
}
