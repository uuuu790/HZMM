
import { AlertTriangle, CheckCircle, RefreshCw, X, Trophy, ArrowUp } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';

// UE mounts paks alphabetically by their path under Content/Paks (case-
// insensitive) and the later mount wins conflicting assets. The main process
// sends that verdict (c.winner, plus c.canWin: who a rename can still make
// win — not a pak whose rival sits in a later folder, as ~mods beats
// Paks/mods/). Without it, fall back to the alphabetically LAST filename,
// which is right while every pak shares one folder.
function currentWinner(mods) {
  return (mods || []).reduce((w, m) =>
    w === null || String(m).toLowerCase() > String(w).toLowerCase() ? m : w, null);
}

// Where a pak sits, shown only when a conflict spans folders.
const folderLabel = (dir) => (dir ? `Paks/${dir}` : 'Paks');

const ConflictModal = ({ isOpen, onClose, scanning, conflicts, onMakeWin, makingWin, t }) => {
  useEscapeKey(onClose, isOpen);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 [-webkit-app-region:no-drag]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-zoom-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-modal-title"
        className="relative w-full max-w-2xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] border border-white/60 dark:border-slate-700/50 overflow-hidden animate-modal-spring"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/50">
          <h3 id="conflict-modal-title" className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" /> {t.conflictScan}
          </h3>
          <button onClick={onClose} aria-label={t.close} className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 max-h-[70vh] overflow-y-auto">
          {scanning ? (
            <div className="flex flex-col items-center gap-3 py-8 text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin text-amber-500" />
              <p className="text-sm font-medium">{t.conflictScanning}</p>
            </div>
          ) : conflicts && conflicts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-emerald-500">
              <CheckCircle className="w-10 h-10" />
              <p className="text-sm font-bold">{t.conflictNone}</p>
            </div>
          ) : conflicts && conflicts.length > 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs font-bold text-amber-600 dark:text-amber-400">{conflicts.length} {t.conflictFound}</p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">{t.conflictOrderHint || 'Paks load alphabetically — the later one wins. Use "Make it win" to reorder.'}</p>
              {conflicts.map((c, i) => {
                const winner = c.winner ?? currentWinner(c.mods);
                const canWin = (m) => !Array.isArray(c.canWin) || c.canWin.includes(m);
                const spansFolders = Array.isArray(c.dirs) && new Set(c.dirs).size > 1;
                return (
                  <div key={i} className="bg-amber-50/60 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-800/40 rounded-xl px-4 py-3">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5 break-all">{t.conflictResource}:<br /><span className="font-mono text-[11px] text-amber-600 dark:text-amber-400">{c.resource}</span></p>
                    <div className="flex flex-col gap-1.5">
                      {c.mods.map((m, j) => {
                        const isWinner = m === winner;
                        const busy = makingWin === m;
                        return (
                          <div key={j} className="flex items-center gap-2 min-w-0">
                            <span className={`flex-1 min-w-0 truncate text-[10px] font-bold px-2 py-1 rounded-full border ${isWinner ? 'bg-emerald-50 dark:bg-emerald-900/25 border-emerald-300/70 dark:border-emerald-700/50 text-emerald-700 dark:text-emerald-400' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
                              {isWinner && <Trophy className="inline w-3 h-3 mr-1 -mt-0.5" />}
                              {m}
                              {spansFolders && (
                                <span className="ml-1.5 font-mono font-medium opacity-60">{folderLabel(c.dirs[j])}</span>
                              )}
                            </span>
                            {isWinner ? (
                              <span className="shrink-0 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 px-2">{t.conflictWinner || 'Active'}</span>
                            ) : !canWin(m) ? (
                              <span
                                className="shrink-0 text-[10px] font-medium text-slate-400 dark:text-slate-500 px-2"
                                title={t.conflictFolderWinsHint || "The winning mod sits in a folder the game loads later; renaming this file can't change that."}
                              >
                                {t.conflictFolderWins || 'Other folder wins'}
                              </span>
                            ) : onMakeWin && (
                              <button
                                onClick={() => !busy && !makingWin && onMakeWin(m, c.mods.filter(x => x !== m))}
                                disabled={busy || !!makingWin}
                                className={`shrink-0 flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-full border transition-all duration-300 active:scale-95 bg-sky-500/10 dark:bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-400/40 dark:border-sky-500/30 ${(busy || makingWin) ? 'opacity-60 pointer-events-none' : 'hover:bg-sky-500/20 hover:border-sky-500/60'}`}
                              >
                                <ArrowUp className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
                                {t.conflictMakeWin || 'Make it win'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ConflictModal;
