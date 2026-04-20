import TypeBadge from './TypeBadge';
import OpenPathButton from './OpenPathButton';
import { resolveI18n, guessValueType } from '../../../utils/config-parser';

// Schema-driven renderer — walks through hzmm.config.json's sections/keys
// structure and renders labeled controls for each. Supports:
//   - type: bool / int / float / string (with optional min/max clamping on blur)
//   - options: [{ value }] → pill selector
//   - showWhen: { dependencyKey: expectedValue } → conditional visibility
//   - enableKey on section → section-wide disable (all but the enableKey)
//   - openPath: { path, relativeTo, action } → jump-to-file button
// Values are resolved from the parsed `entries` list by key-name lookup.

export default function SchemaRenderer({ schema, entries, lang, onUpdateValue, modFilename, addToast }) {
  // Build a lookup map: keyName → entry index
  const keyIndexMap = {};
  entries.forEach((e, i) => { if (e.type === 'keyval') keyIndexMap[e.key] = i; });

  const getValue = (keyName) => {
    const idx = keyIndexMap[keyName];
    return idx !== undefined ? entries[idx].value : undefined;
  };

  return (
    <div className="flex flex-col gap-1">
      {Object.entries(schema.sections).map(([sectionId, section]) => {
        const sectionLabel = resolveI18n(section.label, lang);
        const enableKey = section.enableKey;
        const sectionDisabled = enableKey && getValue(enableKey) === 'false';

        return (
          <div key={sectionId}>
            {/* Section header */}
            <div className="mt-3 mb-1 first:mt-0">
              <h4 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent-500)' }}>{sectionLabel}</h4>
              <div className="h-px mt-1" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.2)' }} />
            </div>

            {/* Keys */}
            {Object.entries(section.keys).map(([keyName, keyDef]) => {
              const entryIdx = keyIndexMap[keyName];
              if (entryIdx === undefined) return null; // Key not found in config file

              const currentValue = entries[entryIdx].value;
              const type = keyDef.type || guessValueType(currentValue);
              const label = resolveI18n(keyDef.label, lang) || keyName;
              const description = resolveI18n(keyDef.description, lang);
              const options = keyDef.options;

              // showWhen conditional visibility
              if (keyDef.showWhen) {
                const visible = Object.entries(keyDef.showWhen).every(([depKey, depVal]) => getValue(depKey) === String(depVal));
                if (!visible) return null;
              }

              // enableKey: disable all keys except the enable key itself
              const isDisabled = sectionDisabled && keyName !== enableKey;

              return (
                <div key={keyName} className={`flex items-center gap-4 py-3.5 border-b border-slate-100 dark:border-slate-800/50 last:border-0 transition-opacity duration-300 ${isDisabled ? 'opacity-30' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-bold text-slate-700 dark:text-slate-200">{label}</label>
                      <TypeBadge type={type} hasOptions={!!options} />
                    </div>
                    {description && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 leading-snug">{description}</p>}
                  </div>
                  {keyDef.openPath && (
                    <OpenPathButton modFilename={modFilename} spec={keyDef.openPath} addToast={addToast} />
                  )}
                  <div className={`shrink-0 w-44 transition-all duration-300 ${isDisabled ? 'pointer-events-none select-none' : ''}`}>
                    {type === 'bool' ? (
                      <button
                        onClick={() => onUpdateValue(entryIdx, currentValue === 'true' ? 'false' : 'true')}
                        className={`relative inline-flex h-6 w-12 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner border border-black/5 dark:border-white/5 active:scale-90 ${currentValue !== 'true' ? 'bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600' : ''}`}
                        style={currentValue === 'true' ? { backgroundColor: 'var(--accent-500)' } : undefined}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-300 ease-in-out shadow-[0_2px_4px_rgba(0,0,0,0.2)] ${currentValue === 'true' ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    ) : options ? (
                      <div className="grid gap-1.5 justify-end" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 4)}, minmax(0, 1fr))` }}>
                        {options.map(opt => {
                          const isActive = opt.value === currentValue;
                          return (
                            <button
                              key={opt.value}
                              onClick={() => onUpdateValue(entryIdx, opt.value)}
                              className={`py-1.5 text-xs font-bold rounded-full text-center transition-all duration-300 active:scale-90 ${
                                !isActive ? 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200/50 dark:border-slate-700/50' : 'text-white border border-transparent'
                              }`}
                              style={isActive ? { backgroundColor: 'var(--accent-500)', boxShadow: '0 4px 8px -2px rgba(var(--accent-rgb), 0.4)' } : undefined}
                            >
                              {opt.value}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <input
                        type="text"
                        inputMode={type === 'int' ? 'numeric' : type === 'float' ? 'decimal' : 'text'}
                        value={currentValue}
                        onChange={(e) => onUpdateValue(entryIdx, e.target.value)}
                        onBlur={(e) => {
                          // min/max clamping on blur
                          e.target.style.borderColor = '';
                          if (keyDef.min !== undefined || keyDef.max !== undefined) {
                            let num = type === 'int' ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
                            if (isNaN(num)) return;
                            if (keyDef.min !== undefined && num < keyDef.min) num = keyDef.min;
                            if (keyDef.max !== undefined && num > keyDef.max) num = keyDef.max;
                            const clamped = type === 'int' ? String(num) : String(parseFloat(num.toFixed(4)));
                            if (clamped !== e.target.value) onUpdateValue(entryIdx, clamped);
                          }
                        }}
                        className="w-full px-3 py-2 text-sm font-mono rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 transition-all duration-200"
                        style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.2)' }}
                        onFocus={(e) => { e.target.style.borderColor = 'var(--accent-400)'; }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
