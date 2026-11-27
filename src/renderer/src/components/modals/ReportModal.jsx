import { useCallback, useEffect, useMemo, useState } from 'react';
import { Send, X, RefreshCw, ChevronDown, CheckCircle, AlertTriangle, Copy, Save, ShieldCheck } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { formatBytes } from '../common/utils';

// The problem-report dialog: shows everything the report would send (each
// part can be unticked and read in full), takes the player's own note and an
// optional Nexus name, then sends it — or saves it as a file when sending
// fails. Opened from Settings or an install / update error toast.

const SECTION_TITLE_KEYS = {
  context: 'reportSectionContext',
  app: 'reportSectionApp',
  hw: 'reportSectionHw',
  disk: 'reportSectionDisk',
  av: 'reportSectionAv',
  game: 'reportSectionGame',
  mods: 'reportSectionMods',
  log: 'reportSectionLog',
};

const NOTE_MAX = 4000;
const NEXUS_NAME_MAX = 64;

const encoder = new TextEncoder();
const byteLength = (s) => encoder.encode(s).length;

// ipcRenderer.invoke wraps a handler's throw as
// "Error invoking remote method 'x': Error: message" — keep the message.
const cleanError = (err) => String(err?.message || err || '').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

const SCROLLBAR = '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full';
const FIELD = 'w-full px-3.5 py-2.5 text-sm rounded-2xl bg-white/60 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[rgba(var(--accent-rgb),0.4)] transition-shadow shadow-inner';
const SECONDARY_BTN = 'flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold rounded-full border border-slate-200/80 dark:border-slate-700/70 bg-white/60 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:text-[var(--accent-600)] dark:hover:text-[var(--accent-400)] hover:border-[rgba(var(--accent-rgb),0.45)] transition-all duration-300 active:scale-95 disabled:opacity-50 disabled:pointer-events-none';

function PrimaryButton({ onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-2 px-5 py-2 text-xs font-bold rounded-full text-white shadow-md transition-all duration-300 active:scale-95 hover:shadow-lg disabled:opacity-50 disabled:pointer-events-none"
      style={{ background: 'linear-gradient(to right, var(--gradient-from), var(--gradient-to))' }}
    >
      {children}
    </button>
  );
}

function SectionRow({ section, title, included, expanded, onToggleInclude, onToggleExpand, disabled, t }) {
  const size = formatBytes(byteLength(section.text));
  return (
    <div className={`rounded-2xl border transition-colors duration-300 ${included ? 'border-slate-200/70 dark:border-slate-700/50 bg-white/40 dark:bg-slate-800/30' : 'border-dashed border-slate-300/70 dark:border-slate-700/60'}`}>
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <label className={`flex items-center gap-2.5 flex-1 min-w-0 select-none ${disabled ? '' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={included}
            disabled={disabled}
            onChange={onToggleInclude}
            className="w-4 h-4 shrink-0 rounded accent-[var(--accent-500)] cursor-pointer"
          />
          <span className={`text-sm font-bold truncate ${included ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500 line-through'}`}>{title}</span>
          <span className="shrink-0 text-[10px] font-mono text-slate-400 dark:text-slate-500">{size}</span>
        </label>
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-[var(--accent-600)] dark:hover:text-[var(--accent-400)] transition-colors"
        >
          {expanded ? t.reportHideContent : t.reportShowContent}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {expanded && (
        <pre className={`mx-3.5 mb-3 max-h-60 overflow-auto rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200/60 dark:border-slate-800/60 p-3 font-mono text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-wrap [overflow-wrap:anywhere] ${SCROLLBAR}`}>
          {section.text}
        </pre>
      )}
    </div>
  );
}

export default function ReportModal({ request, onClose, t }) {
  const isOpen = !!request;
  // collecting → ready → sending → sent; collect-failed / send-failed on errors.
  const [phase, setPhase] = useState('collecting');
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState(null);
  const [excluded, setExcluded] = useState(() => new Set());
  const [expanded, setExpanded] = useState(null);
  const [note, setNote] = useState('');
  const [nexusName, setNexusName] = useState('');
  const [error, setError] = useState('');
  const [sentId, setSentId] = useState('');
  const [savedPath, setSavedPath] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!request) return undefined;
    let cancelled = false;
    setPhase('collecting');
    setPreview(null);
    setExcluded(new Set());
    setExpanded(null);
    setError('');
    setSentId('');
    setSavedPath('');
    setCopied(false);
    window.api.report.collect(request.source, request.context ?? null)
      .then((result) => { if (!cancelled) { setPreview(result); setPhase('ready'); } })
      .catch((err) => { if (!cancelled) { setError(cleanError(err)); setPhase('collect-failed'); } });
    return () => { cancelled = true; };
  }, [request, attempt]);

  // A new report starts with an empty note; a retry of the same one keeps it.
  useEffect(() => {
    setNote('');
    setNexusName('');
  }, [request]);

  const busy = phase === 'sending';
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  useEscapeKey(close, isOpen);

  const sections = useMemo(() => preview?.sections ?? [], [preview]);
  const include = useMemo(() => sections.filter((s) => !excluded.has(s.key)).map((s) => s.key), [sections, excluded]);
  const totalBytes = useMemo(
    () => sections.filter((s) => !excluded.has(s.key)).reduce((sum, s) => sum + byteLength(s.text), byteLength(note) + byteLength(nexusName)),
    [sections, excluded, note, nexusName],
  );
  const canSend = (phase === 'ready' || phase === 'send-failed') && !!preview && (include.length > 0 || note.trim().length > 0);

  const toggleInclude = (key) => setExcluded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const send = async () => {
    if (!canSend) return;
    setPhase('sending');
    setError('');
    setSavedPath('');
    try {
      const { id } = await window.api.report.send(preview.token, include, note, nexusName);
      setSentId(id);
      setPhase('sent');
    } catch (err) {
      setError(cleanError(err));
      setPhase('send-failed');
    }
  };

  const save = async () => {
    if (!preview) return;
    try {
      const filePath = await window.api.report.save(preview.token, include, note, nexusName);
      if (filePath) setSavedPath(filePath);
    } catch (err) {
      setError(cleanError(err));
    }
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(sentId);
      setCopied(true);
    } catch { /* clipboard unavailable — the id stays on screen */ }
  };

  if (!isOpen) return null;

  const editable = phase === 'ready' || phase === 'send-failed';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 [-webkit-app-region:no-drag]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-zoom-in" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-modal-title"
        className="relative w-full max-w-2xl flex flex-col max-h-[90vh] bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] border border-white/60 dark:border-slate-700/50 overflow-hidden animate-modal-spring"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/50 shrink-0">
          <h3 id="report-modal-title" className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Send className="w-5 h-5" style={{ color: 'var(--accent-500)' }} />
            {t.reportTitle}
          </h3>
          <button type="button" onClick={close} disabled={busy} aria-label={t.close} className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className={`flex-1 min-h-0 overflow-y-auto px-6 py-5 ${SCROLLBAR}`}>
          {phase === 'collecting' && (
            <div className="flex flex-col items-center gap-3 py-10 text-slate-400">
              <RefreshCw className="w-7 h-7 animate-spin" style={{ color: 'var(--accent-500)' }} />
              <p className="text-sm font-medium">{t.reportCollecting}</p>
            </div>
          )}

          {phase === 'collect-failed' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-500" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{t.reportCollectFailed}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 break-all">{error}</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className={SECONDARY_BTN}>
                <RefreshCw className="w-3.5 h-3.5" /> {t.retry}
              </button>
            </div>
          )}

          {phase === 'sent' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="p-3 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="w-8 h-8" />
              </div>
              <p className="text-base font-bold text-slate-800 dark:text-slate-100">{t.reportSentTitle}</p>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{t.reportSentId}</span>
                <span className="px-3 py-1 rounded-full font-mono text-sm font-bold tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 select-all">{sentId}</span>
                <button type="button" onClick={copyId} className={SECONDARY_BTN}>
                  {copied ? <CheckCircle className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? t.reportCopied : t.reportCopyId}
                </button>
              </div>
              <p className="max-w-md text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{t.reportSentHint}</p>
            </div>
          )}

          {(editable || busy) && preview && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{t.reportIntro}</p>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="report-note" className="text-xs font-bold text-slate-600 dark:text-slate-300">{t.reportNoteLabel}</label>
                <textarea
                  id="report-note"
                  rows={3}
                  value={note}
                  maxLength={NOTE_MAX}
                  disabled={busy}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t.reportNotePlaceholder}
                  className={`${FIELD} resize-y min-h-[4.5rem]`}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="report-nexus-name" className="text-xs font-bold text-slate-600 dark:text-slate-300">{t.reportNexusLabel}</label>
                <input
                  id="report-nexus-name"
                  type="text"
                  value={nexusName}
                  maxLength={NEXUS_NAME_MAX}
                  disabled={busy}
                  onChange={(e) => setNexusName(e.target.value)}
                  autoComplete="off"
                  className={`${FIELD} max-w-xs`}
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{t.reportNexusHint}</p>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{t.reportPartsLabel}</p>
                {sections.map((section) => (
                  <SectionRow
                    key={section.key}
                    section={section}
                    title={t[SECTION_TITLE_KEYS[section.key]] || section.key}
                    included={!excluded.has(section.key)}
                    expanded={expanded === section.key}
                    onToggleInclude={() => toggleInclude(section.key)}
                    onToggleExpand={() => setExpanded((cur) => (cur === section.key ? null : section.key))}
                    disabled={busy}
                    t={t}
                  />
                ))}
              </div>

              <p className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-500" />
                <span>{t.reportNeverSent}</span>
              </p>
            </div>
          )}
        </div>

        {(editable || busy) && preview && (
          <div className="shrink-0 flex flex-col gap-2 px-6 py-4 border-t border-slate-200/60 dark:border-slate-700/50">
            {phase === 'send-failed' && (
              <p className="flex items-start gap-2 text-xs font-medium text-rose-600 dark:text-rose-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="break-all">{t.reportSendFailed} {error}</span>
              </p>
            )}
            {savedPath && (
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 break-all">{(t.reportSavedTo || '').replace('{path}', savedPath)}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mr-auto">{(t.reportTotalSize || '').replace('{size}', formatBytes(totalBytes))}</span>
              <button type="button" onClick={save} disabled={busy} className={SECONDARY_BTN}>
                <Save className="w-3.5 h-3.5" /> {t.reportSaveFile}
              </button>
              <PrimaryButton onClick={send} disabled={!canSend}>
                {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {busy ? t.reportSending : phase === 'send-failed' ? t.retry : t.reportSend}
              </PrimaryButton>
            </div>
          </div>
        )}

        {phase === 'sent' && (
          <div className="shrink-0 flex justify-end px-6 py-4 border-t border-slate-200/60 dark:border-slate-700/50">
            <PrimaryButton onClick={onClose}>{t.close}</PrimaryButton>
          </div>
        )}
      </div>
    </div>
  );
}
