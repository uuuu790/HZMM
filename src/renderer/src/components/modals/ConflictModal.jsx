
import { AlertTriangle, CheckCircle, RefreshCw, X } from 'lucide-react';

const ConflictModal = ({ isOpen, onClose, scanning, conflicts, t }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-zoom-in" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-modal-spring">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/50">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" /> {t.conflictScan}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 max-h-[60vh] overflow-y-auto">
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
              {conflicts.map((c, i) => (
                <div key={i} className="bg-amber-50/60 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-800/40 rounded-xl px-4 py-3">
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">{t.conflictResource}: <span className="font-mono text-amber-600 dark:text-amber-400">{c.resource}</span></p>
                  <div className="flex flex-wrap gap-1.5">
                    {c.mods.map((m, j) => (
                      <span key={j} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">{m}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ConflictModal;
