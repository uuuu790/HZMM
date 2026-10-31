import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { parseLuaArray, serializeLuaArray } from '../../../utils/config-parser';

// A <textarea> reports its value with every CRLF and lone CR turned into LF,
// so a decoded Lua `\r\n` / `\r` would be saved as `\n` after any edit.
// Given the value before the edit (`prev`, with its real breaks) and the
// textarea's value after it (`next`), this puts the CRs back: the unchanged
// text before and after the edit keeps its original breaks exactly, and a
// break typed or pasted in the edited part takes the value's own style when
// all its breaks are alike (CRLF or CR), else LF.
export function restoreLineBreaks(prev, next) {
  const old = String(prev ?? '');
  if (!old.includes('\r') || next.includes('\r')) return next;
  const norm = old.replace(/\r\n?/g, '\n');
  if (next === norm) return old;
  // start[i]: where normalized char i begins in `old` (a CRLF is one char).
  const start = [];
  for (let i = 0; i < old.length; i++) {
    start.push(i);
    if (old[i] === '\r' && old[i + 1] === '\n') i++;
  }
  start.push(old.length);
  let p = 0;
  while (p < norm.length && p < next.length && norm[p] === next[p]) p++;
  let s = 0;
  while (s < norm.length - p && s < next.length - p && norm[norm.length - 1 - s] === next[next.length - 1 - s]) s++;
  const breaks = old.match(/\r\n|\r|\n/g);
  const nl = breaks.every(b => b === '\r\n') ? '\r\n' : breaks.every(b => b === '\r') ? '\r' : '\n';
  const typed = next.slice(p, next.length - s).replace(/\n/g, nl);
  return old.slice(0, start[p]) + typed + old.slice(start[norm.length - s]);
}

// The editor's one-value text box (list items, the schema and comment-mode
// text rows). A value holding a line break (a decoded Lua `\n` escape) gets a
// <textarea>: an <input type="text"> strips CR/LF from its value, so the first
// keystroke would save the text without them. Once a textarea it stays one,
// so deleting the last line break doesn't swap the element (and focus).
// `onValueChange(text)` gets the new text, with CRs the textarea dropped put
// back (restoreLineBreaks).
export function TextBox({ value, onValueChange, className = '', ...props }) {
  const hasBreak = /[\r\n]/.test(String(value ?? ''));
  const [multiline, setMultiline] = useState(hasBreak);
  if (hasBreak && !multiline) setMultiline(true);
  if (!multiline) {
    return <input type="text" value={value} onChange={(e) => onValueChange?.(e.target.value)} className={className} {...props} />;
  }
  const lines = String(value ?? '').split(/\r\n|\r|\n/).length;
  return (
    <textarea
      rows={Math.min(Math.max(lines, 2), 6)}
      value={value}
      onChange={(e) => onValueChange?.(restoreLineBreaks(value, e.target.value))}
      className={`${className} resize-y`}
      {...props}
    />
  );
}

// Free-form list of strings (no schema-defined options). Each entry has
// its own row with a text input and a delete button; "+ Add" appends a
// blank entry.
//
// Storage: same Lua array literal as MultiSelectInput (`{"a","b"}`),
// serialized via parseLuaArray / serializeLuaArray.

// UI text. ConfigEditorModal passes the localized strings; these English
// fallbacks only show when the widget is mounted without them.
export const DEFAULT_STRING_LIST_TEXT = {
  empty: 'empty',
  add: 'Add',
  remove: 'Remove',
};

export default function StringListInput({ value, disabled, onChange, text = DEFAULT_STRING_LIST_TEXT }) {
  const items = parseLuaArray(value) || [];

  const replace = (next) => onChange(serializeLuaArray(next));
  const setItem = (i, v) => replace(items.map((it, idx) => (idx === i ? v : it)));
  const removeItem = (i) => replace(items.filter((_, idx) => idx !== i));
  const addItem = () => replace([...items, '']);

  return (
    <div className={`flex flex-col gap-1 w-full ${disabled ? 'pointer-events-none' : ''}`}>
      {items.length === 0 && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500 italic text-center py-1">{text.empty}</p>
      )}
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <TextBox
            value={item}
            onValueChange={(v) => setItem(i, v)}
            disabled={disabled}
            className="flex-1 min-w-0 px-2 py-1 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1"
            style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.2)' }}
          />
          <button
            type="button"
            onClick={() => removeItem(i)}
            disabled={disabled}
            title={text.remove}
            aria-label={text.remove}
            className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 active:scale-90 transition-all"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addItem}
        disabled={disabled}
        className="w-full inline-flex items-center justify-center gap-1 py-1 text-[11px] font-bold rounded-md text-slate-500 dark:text-slate-400 bg-slate-100/70 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-700 border border-dashed border-slate-300 dark:border-slate-600 active:scale-95 transition-all"
      >
        <Plus className="w-3 h-3" />
        {text.add}
      </button>
    </div>
  );
}
