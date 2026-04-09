import { useState, useEffect } from 'react';
import { X, FileText, Save, RotateCcw, Sliders, RefreshCw } from 'lucide-react';
import { cleanModName } from '../../constants/modIcons';

// 統一解析 config 檔案（支援 INI / Lua / 混合格式）
function parseConfigFile(text) {
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
      const isDecorative = /^[=\-~*.#\[\](){}<>\/\\|_\s]+$/.test(commentBody) || commentBody.startsWith('=') || commentBody === '';
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
function serializeConfig(entries) {
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

  useEffect(() => {
    if (!isOpen || !mod || !window.api) return;
    setLoading(true);
    setConfigFiles([]);
    setSelectedFile(null);
    setEntries([]);
    setOriginalEntries([]);

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
        for (const file of filtered) {
          try {
            const text = await window.api.mods.readConfig(mod.filename, file.relativePath);
            const parsed = parseConfigFile(text);
            const hasKeyval = parsed.some(e => e.type === 'keyval');
            if (hasKeyval) {
              validFiles.push(file);
              parsed.forEach(e => { e._file = file; });
              allEntries.push(...parsed);
            }
          } catch { /* skip */ }
        }

        setConfigFiles(validFiles);
        setSelectedFile(validFiles.length > 0 ? validFiles[0] : null);
        setEntries(allEntries);
        setOriginalEntries(JSON.parse(JSON.stringify(allEntries)));
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
                  // 只顯示下方有 keyval 的 section
                  let hasKeys = false;
                  for (let j = idx + 1; j < entries.length; j++) {
                    if (entries[j].type === 'section') break;
                    if (entries[j].type === 'keyval') { hasKeys = true; break; }
                  }
                  if (!hasKeys) return null;
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

                // 取得描述：往上搜尋 "KeyName - ..." 或 "KeyName : ..." 格式的註解
                let description = null;
                for (let i = idx - 1; i >= 0; i--) {
                  const e = entries[i];
                  if (e.type === 'keyval' || e.type === 'section' || e.type === 'lua_structure') break;
                  if (e.type !== 'comment' || !e.text) continue;
                  const m = e.text.match(new RegExp(`^${entry.key}\\s*[-:–—]\\s*(.+)`, 'i'));
                  if (m) { description = m[1].trim(); break; }
                }
                // 沒找到，取上方緊鄰 comment block 最頂部的描述
                if (!description) {
                  for (let i = idx - 1; i >= 0; i--) {
                    const e = entries[i];
                    if (e.type === 'keyval' || e.type === 'section' || e.type === 'lua_structure' || e.type === 'blank') break;
                    if (e.type === 'comment' && !e.text) break; // 裝飾線/空註解 → 停
                    if (e.type === 'comment' && e.text) description = e.text; // 持續覆蓋，留最頂的
                  }
                }
                // 行內註解 (-- vanilla default)
                if (!description && entry.inlineDesc) {
                  description = entry.inlineDesc;
                }
                // 往下找描述（跳過裝飾線，取第一條非空註解）
                if (!description) {
                  for (let i = idx + 1; i < entries.length; i++) {
                    const e = entries[i];
                    if (e.type === 'keyval' || e.type === 'section' || e.type === 'lua_structure' || e.type === 'blank') break;
                    if (e.type === 'comment' && !e.text) continue; // 裝飾線跳過
                    if (e.type === 'comment' && e.text) { description = e.text; break; }
                  }
                }
                // fallback: key 名稱轉可讀格式
                if (!description) {
                  description = entry.key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
                }
                if (description.length > 60) description = description.slice(0, 60) + '...';

                // 從上方註解偵測選項列表（"value" : desc 格式）
                let options = null;
                if (valType === 'string') {
                  const opts = [];
                  for (let i = idx - 1; i >= 0; i--) {
                    const e = entries[i];
                    if (e.type === 'keyval' || e.type === 'section' || e.type === 'lua_structure' || e.type === 'blank') break;
                    if (e.type === 'comment' && e.text) {
                      const optMatch = e.text.match(/^"(.+?)"\s*[:：\-–—]\s*.+/);
                      if (optMatch) opts.push(optMatch[1]);
                    }
                  }
                  if (opts.length >= 2) options = opts.reverse();
                }

                // 偵測條件依賴
                let isDisabled = false;

                // 1. 明確註解：Active when Key = "Value"
                for (let i = idx - 1; i >= 0; i--) {
                  const e = entries[i];
                  if (e.type === 'keyval' || e.type === 'section' || e.type === 'lua_structure' || e.type === 'blank') break;
                  if (e.type === 'comment' && e.text) {
                    const depMatch = e.text.match(/(\w+)\s*=\s*"(.+?)"/);
                    if (depMatch) {
                      const depEntry = entries.find(en => en.type === 'keyval' && en.key === depMatch[1]);
                      if (depEntry && depEntry.value !== depMatch[2]) isDisabled = true;
                      break;
                    }
                  }
                }

                // 2. Section Enable 開關：同 section 內的 Enable_* bool key 控制其他 key
                if (!isDisabled && !entry.key.match(/^Enable/i)) {
                  // 往回找同 section 內的 Enable_* key
                  for (let i = idx - 1; i >= 0; i--) {
                    if (entries[i].type === 'section') break; // 碰到 section 邊界就停
                    if (entries[i].type === 'keyval' && entries[i].key.match(/^Enable/i)) {
                      if (entries[i].value === 'false') isDisabled = true;
                      break;
                    }
                  }
                }

                return (
                  <div key={idx} className={`flex items-center gap-4 py-3.5 border-b border-slate-100 dark:border-slate-800/50 last:border-0 transition-opacity duration-300 ${isDisabled ? 'opacity-30' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <label className="text-sm font-bold text-slate-700 dark:text-slate-200">{entry.key}</label>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full leading-none ${
                          valType === 'bool' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                          : valType === 'int' || valType === 'float' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                          : options ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                        }`}>{valType === 'bool' ? 'ON/OFF' : valType === 'int' ? 'INT' : valType === 'float' ? 'FLOAT' : options ? 'SELECT' : 'TEXT'}</span>
                      </div>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 leading-snug">{description}</p>
                    </div>
                    <div className={`shrink-0 w-44 transition-all duration-300 ${isDisabled ? 'pointer-events-none select-none' : ''}`}>
                      {valType === 'bool' ? (
                        <button
                          onClick={() => updateValue(globalIdx, entry.value === 'true' ? 'false' : 'true')}
                          className={`relative inline-flex h-6 w-12 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner border border-black/5 dark:border-white/5 active:scale-90 ${entry.value !== 'true' ? 'bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600' : ''}`}
                          style={entry.value === 'true' ? { backgroundColor: 'var(--accent-500)' } : undefined}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-300 ease-in-out shadow-[0_2px_4px_rgba(0,0,0,0.2)] ${entry.value === 'true' ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      ) : options ? (
                        <div className="flex gap-1.5 flex-wrap justify-end">
                          {options.map(opt => (
                            <button
                              key={opt}
                              onClick={() => updateValue(globalIdx, opt)}
                              className={`px-3 py-1.5 text-xs font-bold rounded-full transition-all duration-300 active:scale-90 ${
                                opt !== entry.value ? 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200/50 dark:border-slate-700/50' : 'text-white border border-transparent'
                              }`}
                              style={opt === entry.value ? { backgroundColor: 'var(--accent-500)', boxShadow: '0 4px 8px -2px rgba(var(--accent-rgb), 0.4)' } : undefined}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
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
