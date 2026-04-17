import { useState, useEffect } from 'react';
import { Download, ThumbsUp, RefreshCw, Play, User, Check } from 'lucide-react';

// Format large numbers as "1.2k" / "3.4M" / "567"
function formatCount(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export default function NexusModCard({ mod, t, onClick, onQuickInstall, installing, installingAny, index = 0 }) {
  // Brief "just installed" flash — mirror the installing prop going
  // true → false, then clear the green check after ~1.5s so the next
  // install session isn't still greeted with success state.
  const [justDone, setJustDone] = useState(false);
  const [wasInstalling, setWasInstalling] = useState(false);
  useEffect(() => {
    if (installing) {
      setWasInstalling(true);
    } else if (wasInstalling) {
      setWasInstalling(false);
      setJustDone(true);
      const tid = setTimeout(() => setJustDone(false), 1600);
      return () => clearTimeout(tid);
    }
  }, [installing, wasInstalling]);

  const thumb = mod.picture_url;
  const author = mod.author || mod.uploaded_by || '—';
  const version = mod.version || '';
  const downloads = mod.mod_downloads ?? mod.mod_unique_downloads ?? 0;
  const endorsements = mod.endorsement_count ?? 0;
  const adult = mod.contains_adult_content;

  // Stagger the card entrance so the grid streams in instead of popping. Cap
  // the visible delay around the first ~1.5 screens of cards; past that the
  // user has already scrolled past the animation so the delay is just debt.
  const delayMs = Math.min(index, 20) * 35;

  return (
    <div
      onClick={onClick}
      className="group relative flex flex-col rounded-2xl bg-white/60 dark:bg-slate-900/50 border border-slate-200/50 dark:border-slate-700/50 overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_12px_28px_rgba(0,0,0,0.4)] hover:border-slate-300/70 dark:hover:border-slate-600/70 animate-slide-up"
      style={{ animationFillMode: 'both', animationDelay: `${delayMs}ms`, animationDuration: '420ms' }}
    >
      {/* Thumbnail */}
      <div className="relative aspect-[16/9] bg-slate-100 dark:bg-slate-800 overflow-hidden">
        {thumb ? (
          <img
            src={thumb}
            alt={mod.name}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600">
            <span className="text-4xl font-black">?</span>
          </div>
        )}
        {adult && (
          <span className="absolute top-2 right-2 px-2 py-0.5 text-[10px] font-black tracking-widest uppercase bg-red-500 text-white rounded-full shadow-md">
            18+
          </span>
        )}
        {version && (
          <span className="absolute bottom-2 left-2 px-2 py-0.5 text-[10px] font-mono font-bold bg-black/60 backdrop-blur-sm text-white rounded-full">
            v{version}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col gap-2 p-4 flex-1">
        <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 line-clamp-2 leading-snug">
          {mod.name}
        </h3>
        <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
          <User className="w-3 h-3" />
          <span className="truncate">{author}</span>
        </div>
        {mod.summary && (
          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed flex-1">
            {mod.summary}
          </p>
        )}

        {/* Stats + install */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/60 mt-auto">
          <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 min-w-0">
            <span className="flex items-center gap-1" title={t.nexusDownloads}>
              <Download className="w-3 h-3" />
              {formatCount(downloads)}
            </span>
            <span className="flex items-center gap-1" title={t.nexusEndorsements}>
              <ThumbsUp className="w-3 h-3" />
              {formatCount(endorsements)}
            </span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); if (!installingAny && !justDone) onQuickInstall(); }}
            disabled={installingAny || justDone}
            title={t.nexusInstallLatest}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-full transition-all duration-300 active:scale-95 ${
              justDone
                ? 'bg-emerald-500 text-white'
                : installingAny
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                : 'text-white'
            }`}
            style={justDone
              ? { boxShadow: '0 4px 10px -2px rgba(16, 185, 129, 0.5)' }
              : !installingAny
              ? { backgroundColor: 'var(--accent-500)', boxShadow: '0 4px 10px -2px rgba(var(--accent-rgb), 0.4)' }
              : undefined}
          >
            {justDone
              ? <Check className="w-3 h-3" />
              : installing
              ? <RefreshCw className="w-3 h-3 animate-spin" />
              : <Play className="w-3 h-3 fill-current" />}
            <span className="hidden sm:inline">
              {justDone ? t.nexusInstalledToast : installing ? t.nexusInstalling : t.nexusInstall}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
