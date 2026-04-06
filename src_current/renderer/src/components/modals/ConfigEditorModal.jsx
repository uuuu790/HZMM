import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, FileText, Save, RotateCcw, Sliders, RefreshCw, Code2, SlidersHorizontal } from 'lucide-react';
import { cleanModName } from '../../constants/modIcons';

// --- Language detection from file extension ---
function detectLanguage(filename) {
  if (!filename) return 'text';
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    lua: 'lua', ini: 'ini', cfg: 'ini', conf: 'ini',
    json: 'json', yaml: 'yaml', yml: 'yaml',
    xml: 'xml', toml: 'toml',
  };
  return map[ext] || 'text';
}

// --- Syntax highlighting functions ---
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightLua(text) {
  const keywords = new Set(['local', 'function', 'end', 'if', 'then', 'else', 'elseif', 'return', 'for', 'while', 'do', 'repeat', 'until', 'in', 'and', 'or', 'not', 'true', 'false', 'nil']);
  return text.split('\n').map(line => {
    const escaped = escapeHtml(line);
    // Block comment lines
    if (/^\s*--\[\[/.test(line) || /^\s*\]\]/.test(line)) {
      return `<span class="sh-comment">${escaped}</span>`;
    }
    // Single-line comment
    const commentIdx = escaped.indexOf('--');
    let code = commentIdx >= 0 ? escaped.slice(0, commentIdx) : escaped;
    let comment = commentIdx >= 0 ? `<span class="sh-comment">${escaped.slice(commentIdx)}</span>` : '';
    // Strings
    code = code.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="sh-string">$1</span>');
    // Numbers
    code = code.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-number">$1</span>');
    // Keywords
    code = code.replace(/\b(\w+)\b/g, (m) => keywords.has(m) ? `<span class="sh-keyword">${m}</span>` : m);
    return code + comment;
  }).join('\n');
}

function highlightIni(text) {
  return text.split('\n').map(line => {
    const escaped = escapeHtml(line);
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith(';')) return `<span class="sh-comment">${escaped}</span>`;
    if (trimmed.startsWith('[') && trimmed.includes(']')) return `<span class="sh-tag">${escaped}</span>`;
    const eqIdx = escaped.indexOf('=');
    if (eqIdx > 0) {
      const key = escaped.slice(0, eqIdx);
      let val = escaped.slice(eqIdx + 1);
      val = val.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="sh-string">$1</span>');
      val = val.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-number">$1</span>');
      val = val.replace(/\b(true|false)\b/gi, '<span class="sh-keyword">$1</span>');
      return `<span class="sh-keyword">${key}</span>=${val}`;
    }
    return escaped;
  }).join('\n');
}

function highlightJson(text) {
  return text.split('\n').map(line => {
    let escaped = escapeHtml(line);
    // Key: "key":
    escaped = escaped.replace(/(&quot;)((?:[^&]|&(?!quot;))*)(&quot;)\s*:/g, '<span class="sh-keyword">$1$2$3</span>:');
    // String values
    escaped = escaped.replace(/:\s*(&quot;)((?:[^&]|&(?!quot;))*)(&quot;)/g, ': <span class="sh-string">$1$2$3</span>');
    // Standalone strings (in arrays)
    escaped = escaped.replace(/(^\s*|,\s*)(&quot;)((?:[^&]|&(?!quot;))*)(&quot;)/g, '$1<span class="sh-string">$2$3$4</span>');
    // Numbers
    escaped = escaped.replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="sh-number">$1</span>');
    // Booleans and null
    escaped = escaped.replace(/\b(true|false|null)\b/g, '<span class="sh-keyword">$1</span>');
    return escaped;
  }).join('\n');
}

function highlightYaml(text) {
  return text.split('\n').map(line => {
    const escaped = escapeHtml(line);
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) return `<span class="sh-comment">${escaped}</span>`;
    // Inline comment
    const hashIdx = escaped.indexOf(' #');
    let code = hashIdx >= 0 ? escaped.slice(0, hashIdx) : escaped;
    let comment = hashIdx >= 0 ? `<span class="sh-comment">${escaped.slice(hashIdx)}</span>` : '';
    // Key: value
    const colonIdx = code.indexOf(':');
    if (colonIdx > 0) {
      const key = code.slice(0, colonIdx);
      let val = code.slice(colonIdx + 1);
      val = val.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="sh-string">$1</span>');
      val = val.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-number">$1</span>');
      val = val.replace(/\b(true|false|null|~)\b/g, '<span class="sh-keyword">$1</span>');
      return `<span class="sh-tag">${key}</span>:${val}${comment}`;
    }
    // Strings
    code = code.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="sh-string">$1</span>');
    return code + comment;
  }).join('\n');
}

function highlightXml(text) {
  return text.split('\n').map(line => {
    let escaped = escapeHtml(line);
    // Comments
    if (/&lt;!--/.test(escaped)) return `<span class="sh-comment">${escaped}</span>`;
    // Tags
    escaped = escaped.replace(/(&lt;\/?)([\w:-]+)/g, '$1<span class="sh-tag">$2</span>');
    // Attributes
    escaped = escaped.replace(/([\w:-]+)(=)/g, '<span class="sh-keyword">$1</span>$2');
    // Strings in attributes
    escaped = escaped.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="sh-string">$1</span>');
    return escaped;
  }).join('\n');
}

function highlightToml(text) {
  return text.split('\n').map(line => {
    const escaped = escapeHtml(line);
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) return `<span class="sh-comment">${escaped}</span>`;
    if (trimmed.startsWith('[')) return `<span class="sh-tag">${escaped}</span>`;
    const eqIdx = escaped.indexOf('=');
    if (eqIdx > 0) {
      const key = escaped.slice(0, eqIdx);
      let val = escaped.slice(eqIdx + 1);
      val = val.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="sh-string">$1</span>');
      val = val.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-number">$1</span>');
      val = val.replace(/\b(true|false)\b/g, '<span class="sh-keyword">$1</span>');
      return `<span class="sh-keyword">${key}</span>=${val}`;
    }
    return escaped;
  }).join('\n');
}

function highlightText(text, language) {
  switch (language) {
    case 'lua': return highlightLua(text);
    case 'ini': return highlightIni(text);
    case 'json': return highlightJson(text);
    case 'yaml': return highlightYaml(text);
    case 'xml': return highlightXml(text);
    case 'toml': return highlightToml(text);
    default: return escapeHtml(text);
  }
}

// --- HighlightedEditor component ---
function HighlightedEditor({ value, onChange, language }) {
  const textareaRef = useRef(null);
  const preRef = useRef(null);
  const lineNumbersRef = useRef(null);

  const handleScroll = useCallback(() => {
    const ta = textareaRef.current;
    if (ta && preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (ta && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = ta.scrollTop;
    }
  }, []);

  const highlighted = useMemo(() => highlightText(value, language), [value, language]);
  const lineCount = useMemo(() => value.split('\n').length, [value]);

  const handleTab = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newValue = value.slice(0, start) + '  ' + value.slice(end);
      onChange(newValue);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }, [value, onChange]);

  return (
    <div className="highlighted-editor relative flex rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700/50">
      {/* Syntax highlight styles */}
      <style>{`
        .sh-keyword { color: var(--accent-500); }
        .sh-string { color: #22c55e; }
        .sh-comment { color: #94a3b8; }
        .dark .sh-comment { color: #64748b; }
        .sh-number { color: #f59e0b; }
        .sh-tag { color: #3b82f6; }
      `}</style>

      {/* Line numbers */}
      <div
        ref={lineNumbersRef}
        className="shrink-0 select-none overflow-hidden text-right pr-3 pl-3 py-3 text-xs font-mono leading-[1.625] text-slate-400 dark:text-slate-600 bg-slate-100/80 dark:bg-slate-900/80 border-r border-slate-200 dark:border-slate-700/50"
        aria-hidden="true"
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>

      {/* Editor area */}
      <div className="relative flex-1 min-w-0">
        {/* Highlighted pre layer */}
        <pre
          ref={preRef}
          className="absolute inset-0 m-0 p-3 text-sm font-mono leading-[1.625] whitespace-pre overflow-hidden pointer-events-none text-slate-700 dark:text-slate-200"
          aria-hidden="true"
        >
          <code dangerouslySetInnerHTML={{ __html: highlighted + '\n' }} />
        </pre>

        {/* Transparent textarea layer */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          onKeyDown={handleTab}
          spellCheck={false}
          className="relative w-full h-full min-h-[350px] resize-none p-3 text-sm font-mono leading-[1.625] whitespace-pre overflow-auto bg-transparent text-transparent caret-slate-800 dark:caret-slate-200 outline-none selection:bg-blue-200/40 dark:selection:bg-blue-500/20"
          style={{ WebkitTextFillColor: 'transparent' }}
        />
      </div>
    </div>
  );
}

// 統一解析 config 檔案（支援 INI / Lua / 混合格式）
function parseConfigFile(text) {
  const lines = text.split('\n');
  const entries = [];
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // 空行
    if (trimmed === '') { entries.push({ type: 'blank', raw: line }); continue; }

    // Lua 多行註解 --[[ ... ]]
    if (trimmed.includes('--[[') && !inBlockComment) { inBlockComment = true; entries.push({ type: 'comment', raw: line, text: '' }); continue; }
    if (inBlockComment) { if (trimmed.includes(']]')) inBlockComment = false; entries.push({ type: 'comment', raw: line, text: '' }); continue; }

    // 各種單行註解（-- ; # //）
    if (trimmed.startsWith('--') || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      let commentBody = trimmed.replace(/^(--|;|#|\/\/)\s*/, '');
      // 分隔線、裝飾線、純符號行 → 不顯示文字
      const isDecorative = /^[=\-~*#\[\](){}<>\/\\|_\s]+$/.test(commentBody) || commentBody.startsWith('=') || commentBody === '';
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
      // 去掉引號取裸值
      const isQuoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
      const bareValue = isQuoted ? value.slice(1, -1) : value;
      // 判斷原始格式（有逗號結尾或在 Lua 結構內 → lua）
      const isLua = line.match(/,\s*$/) || text.includes('--[[');
      entries.push({ type: 'keyval', raw: line, key: kvMatch[1], value: bareValue, isQuoted, format: isLua ? 'lua' : 'ini' });
      continue;
    }

    // 其他 → 當註解處理
    entries.push({ type: 'comment', raw: line, text: '' });
  }
  return entries;
}

// 將結構化資料轉回文字
function serializeConfig(entries) {
  return entries.map((e) => {
    if (e.type === 'keyval') {
      const indent = e.raw.match(/^(\s*)/)?.[1] || '';
      const val = e.isQuoted ? `"${e.value}"` : e.value;
      const comma = e.format === 'lua' && e.raw.match(/,\s*$/) ? ',' : '';
      return `${indent}${e.key} = ${val}${comma}`;
    }
    return e.raw;
  }).join('\n');
}

// 判斷值類型
function guessValueType(val) {
  if (val === 'true' || val === 'false') return 'bool';
  if (/^-?\d+$/.test(val)) return 'int';
  if (/^-?\d+\.\d+$/.test(val)) return 'float';
  return 'string';
}

const ConfigEditorModal = ({ isOpen, mod, onClose, t, lang, addToast }) => {
  const [configFiles, setConfigFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [entries, setEntries] = useState([]);
  const [originalEntries, setOriginalEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Raw editor mode
  const [editorMode, setEditorMode] = useState('structured'); // 'structured' | 'raw'
  const [rawTexts, setRawTexts] = useState({}); // { [relativePath]: text }
  const [originalRawTexts, setOriginalRawTexts] = useState({});
  const [activeFile, setActiveFile] = useState(null);

  useEffect(() => {
    if (!isOpen || !mod || !window.api) return;
    setLoading(true);
    setConfigFiles([]);
    setSelectedFile(null);
    setEntries([]);
    setOriginalEntries([]);
    setRawTexts({});
    setOriginalRawTexts({});
    setActiveFile(null);
    setEditorMode('structured');

    (async () => {
      try {
        const files = await window.api.mods.getConfigFiles(mod.filename);
        // 過濾掉 main.lua 和 Scripts 內的檔案
        const filtered = (files || []).filter(f =>
          f.name.toLowerCase() !== 'main.lua' &&
          !f.relativePath.toLowerCase().startsWith('scripts/')
        );

        // 合併所有有 key=value 的設定項
        const allEntries = [];
        const validFiles = [];
        const texts = {};
        for (const file of filtered) {
          try {
            const text = await window.api.mods.readConfig(mod.filename, file.relativePath);
            const parsed = parseConfigFile(text);
            const hasKeyval = parsed.some(e => e.type === 'keyval');
            if (hasKeyval) {
              validFiles.push(file);
              texts[file.relativePath] = text;
              // 加上檔案來源標記
              parsed.forEach(e => { e._file = file; });
              allEntries.push(...parsed);
            }
          } catch { /* skip */ }
        }

        setConfigFiles(validFiles);
        setSelectedFile(validFiles.length > 0 ? validFiles[0] : null);
        setActiveFile(validFiles.length > 0 ? validFiles[0] : null);
        setEntries(allEntries);
        setOriginalEntries(JSON.parse(JSON.stringify(allEntries)));
        setRawTexts(texts);
        setOriginalRawTexts({ ...texts });
      } catch {
        setConfigFiles([]);
      }
      setLoading(false);
    })();
  }, [isOpen, mod]);

  const updateValue = (idx, newValue) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, value: newValue } : e));
  };

  const handleSave = async () => {
    if (!mod || configFiles.length === 0) return;
    setSaving(true);
    try {
      // 按檔案分組儲存
      for (const file of configFiles) {
        const fileEntries = entries.filter(e => e._file?.relativePath === file.relativePath);
        const text = serializeConfig(fileEntries);
        await window.api.mods.saveConfig(mod.filename, file.relativePath, text);
      }
      setOriginalEntries(JSON.parse(JSON.stringify(entries)));
      addToast(t.toastConfigSaved, 'success');
    } catch {
      addToast(t.toastConfigError, 'error');
    }
    setSaving(false);
  };

  const handleReset = () => {
    setEntries(JSON.parse(JSON.stringify(originalEntries)));
  };

  const hasChanges = JSON.stringify(entries) !== JSON.stringify(originalEntries);
  const keyvalEntries = entries.filter(e => e.type === 'keyval');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm animate-zoom-in duration-300" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg max-h-[85vh] bg-white/90 dark:bg-slate-900/90 backdrop-blur-2xl border border-white/60 dark:border-slate-700/50 rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] animate-modal-spring flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/50">
          <div className="p-2.5 rounded-full" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.1)', color: 'var(--accent-500)' }}>
            <Sliders className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-black text-slate-800 dark:text-white tracking-tight truncate">{t.configEditor}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium truncate">{cleanModName(mod?.title || mod?.filename || '')}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 active:scale-90">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 dark:text-slate-500">
              <RefreshCw className="w-5 h-5 animate-spin" />
            </div>
          ) : configFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 gap-2">
              <FileText className="w-10 h-10 mb-1" />
              <p className="text-sm font-medium">{t.configNoFiles}</p>
            </div>
          ) : keyvalEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 gap-2">
              <FileText className="w-10 h-10 mb-1" />
              <p className="text-sm font-medium">{t.configNoFiles}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {entries.map((entry, idx) => {
                if (entry.type === 'section') {
                  return (
                    <div key={idx} className="mt-3 mb-1 first:mt-0">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent-500)' }}>{entry.name}</h4>
                      <div className="h-px mt-1" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.2)' }} />
                    </div>
                  );
                }
                if (entry.type !== 'keyval') return null;

                const valType = guessValueType(entry.value);
                const globalIdx = idx;

                // 取得上方緊鄰的註解作為描述
                let description = null;
                for (let i = idx - 1; i >= 0; i--) {
                  if (entries[i].type === 'comment' && entries[i].text) { description = entries[i].text; break; }
                  if (entries[i].type === 'blank') continue;
                  break;
                }
                // 清理註解格式，根據語言選擇
                if (description) {
                  const slashParts = description.split('/').map(s => s.trim()).filter(Boolean);
                  if (slashParts.length > 1) {
                    const zhPart = slashParts.find(s => /[\u4e00-\u9fff]/.test(s));
                    const enPart = slashParts.find(s => !/[\u4e00-\u9fff]/.test(s));
                    if (lang === 'zh-TW' && zhPart) description = zhPart;
                    else if (lang !== 'zh-TW' && enPart) description = enPart;
                    else if (zhPart) description = zhPart;
                  }
                  // 移除 「範例 :」「Example :」「"Fixed" :」 開頭
                  description = description.replace(/^["'].+?["']\s*[:：]\s*/g, '');
                  description = description.replace(/^(範例|example|e\.g\.?|ex)\s*[:：]\s*/i, '');
                  description = description.replace(/^["']|["']$/g, '').trim();
                  if (description.length > 40) description = description.slice(0, 40) + '...';
                }
                // 如果沒有註解，根據 key 名稱生成可讀文字
                if (!description) {
                  description = entry.key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
                }

                return (
                  <div key={idx} className="flex items-center gap-4 py-3.5 border-b border-slate-100 dark:border-slate-800/50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <label className="text-sm font-bold text-slate-700 dark:text-slate-200">{entry.key}</label>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full leading-none ${
                          valType === 'bool' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                          : valType === 'int' || valType === 'float' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                        }`}>{valType === 'bool' ? 'ON/OFF' : valType === 'int' ? 'INT' : valType === 'float' ? 'FLOAT' : 'TEXT'}</span>
                      </div>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 leading-snug">{description}</p>
                    </div>
                    <div className="shrink-0 w-44">
                      {valType === 'bool' ? (
                        <button
                          onClick={() => updateValue(globalIdx, entry.value === 'true' ? 'false' : 'true')}
                          className={`relative inline-flex h-6 w-12 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner border border-black/5 dark:border-white/5 active:scale-90 ${entry.value !== 'true' ? 'bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600' : ''}`}
                          style={entry.value === 'true' ? { backgroundColor: 'var(--accent-500)' } : undefined}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-300 ease-in-out shadow-[0_2px_4px_rgba(0,0,0,0.2)] ${entry.value === 'true' ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      ) : (
                        <input
                          type="text"
                          inputMode={valType === 'int' ? 'numeric' : valType === 'float' ? 'decimal' : 'text'}
                          value={entry.value}
                          onChange={(e) => updateValue(globalIdx, e.target.value)}
                          className="w-full px-3 py-2 text-sm font-mono rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 transition-all duration-200"
                          style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.2)' }}
                          onFocus={(e) => { e.target.style.borderColor = 'var(--accent-400)'; }}
                          onBlur={(e) => { e.target.style.borderColor = ''; }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {keyvalEntries.length > 0 && (
          <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-200/60 dark:border-slate-700/50">
            <button
              onClick={handleReset}
              disabled={!hasChanges}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-full text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-300 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t.configReset}
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold rounded-full text-white transition-all duration-300 active:scale-95 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--accent-500)', boxShadow: '0 10px 15px -3px rgba(var(--accent-rgb), 0.3)' }}
            >
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? t.configSaving : hasChanges ? t.configSave : t.configSaved}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConfigEditorModal;
