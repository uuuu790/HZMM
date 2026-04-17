import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, ThumbsUp, User, ExternalLink, RefreshCw, Play, FileArchive, Calendar, Crown } from 'lucide-react';
import { bbcodeToHtml } from '../../utils/bbcode';

// Group files by Nexus category_id. 1=Main 2=Update 3=Optional 4=Old 5=Misc
// 6=Deleted 7=Archived — we hide 6/7.
const CATEGORY_ORDER = [
  { id: 1, labelKey: 'nexusFilesMain', accent: true },
  { id: 3, labelKey: 'nexusFilesOptional' },
  { id: 2, labelKey: 'nexusFilesUpdate' },
  { id: 5, labelKey: 'nexusFilesMisc' },
  { id: 4, labelKey: 'nexusFilesOld' },
];

function formatCount(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
function formatBytes(n) {
  if (!n) return '—';
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}
function formatDate(ts) {
  if (!ts) return '—';
  // V2 returns ISO 8601 strings ("2026-04-17T15:31:48Z"); V1 / file endpoints
  // return unix epoch seconds (number). Detect which and branch.
  try {
    if (typeof ts === 'string') return new Date(ts).toLocaleDateString();
    return new Date(ts * 1000).toLocaleDateString();
  } catch { return '—'; }
}

// V2 returns camelCase, but the render code below was written against V1's
// snake_case. Adapt the detail payload once so the JSX stays flat.
function adaptV2Mod(v2) {
  if (!v2) return null;
  return {
    ...v2,
    mod_id: v2.modId,
    picture_url: v2.thumbnailLargeUrl || v2.pictureUrl || v2.thumbnailUrl,
    mod_downloads: v2.downloads,
    mod_unique_downloads: v2.downloads,
    endorsement_count: v2.endorsements,
    updated_timestamp: v2.updatedAt,
    uploaded_by: v2.uploader?.name || v2.author,
    author: v2.author || v2.uploader?.name,
    contains_adult_content: v2.adultContent,
  };
}

export default function NexusModDetailModal({ mod, t, lang: _lang, onClose, addToast, isPremium }) {
  const modIdNum = mod.modId || modIdNum;

  const [detail, setDetail] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [installingFileId, setInstallingFileId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      window.api.nexus.getModDetail(modIdNum),
      window.api.nexus.getModFiles(modIdNum),
    ]).then(([d, f]) => {
      if (cancelled) return;
      if (!d.ok) { setError(d.reason || 'unknown'); setLoading(false); return; }
      setDetail(adaptV2Mod(d.mod));
      setFiles(f.ok ? (f.files || []) : []);
      setLoading(false);
    }).catch(err => {
      if (cancelled) return;
      setError(err?.message || 'unknown');
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [modIdNum]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleInstallFile = async (file) => {
    if (installingFileId) return;
    if (!isPremium) {
      addToast(t.nexusPremiumRequired, 'error');
      return;
    }
    setInstallingFileId(file.file_id);
    try {
      await window.api.nexus.installFile(modIdNum, file.file_id);
      addToast(`${t.nexusInstalledToast}: ${file.name}`, 'success');
    } catch (err) {
      addToast(`${t.nexusInstallFailedToast}: ${err?.message || err}`, 'error');
    } finally {
      setInstallingFileId(null);
    }
  };

  const openOnNexus = () => {
    window.api?.system?.openExternal?.(`https://www.nexusmods.com/humanitz/mods/${modIdNum}`);
  };

  // Nexus v1 API returns descriptions in BBCode (not Markdown). Convert
  // through our bbcode utility, which escapes HTML entities first and only
  // emits a safe subset of tags. YouTube embeds degrade to external links
  // because CSP blocks iframes.
  const descriptionHtml = detail?.description ? bbcodeToHtml(detail.description) : null;

  const handleReadmeClick = (e) => {
    // Same pattern as ModDetailModal — route any anchor click through
    // shell.openExternal to bypass will-navigate.
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;
    e.preventDefault();
    if (/^(https?:|mailto:)/i.test(href)) window.api?.system?.openExternal?.(href);
  };

  // Group files by category
  const groupedFiles = {};
  for (const f of files) {
    const cat = f.category_id;
    if (cat === 6 || cat === 7) continue;
    if (!groupedFiles[cat]) groupedFiles[cat] = [];
    groupedFiles[cat].push(f);
  }
  // Sort each group newest-first
  for (const k of Object.keys(groupedFiles)) {
    groupedFiles[k].sort((a, b) => (b.uploaded_timestamp || 0) - (a.uploaded_timestamp || 0));
  }

  const displayMod = detail || mod;
  const thumb = displayMod.picture_url;
  const author = displayMod.author || displayMod.uploaded_by || '—';
  const downloads = displayMod.mod_downloads ?? displayMod.mod_unique_downloads ?? 0;
  const endorsements = displayMod.endorsement_count ?? 0;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-6 [-webkit-app-region:no-drag]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm animate-zoom-in duration-300" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-[92vw] max-w-[1400px] max-h-[85vh] bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border border-white/60 dark:border-slate-700/50 rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] animate-modal-spring flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="relative shrink-0">
          {thumb && (
            <div className="relative h-48 overflow-hidden">
              <img src={thumb} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              <div className="absolute inset-0 bg-gradient-to-t from-white/95 dark:from-slate-900/95 via-white/40 dark:via-slate-900/40 to-transparent" />
            </div>
          )}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 shadow-md active:scale-90 transition-all"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>

          <div className={`px-8 ${thumb ? 'pb-5 -mt-12 relative' : 'py-6'}`}>
            <h2 className="text-2xl font-black text-slate-900 dark:text-slate-50 leading-tight mb-2">{displayMod.name}</h2>
            <div className="flex items-center gap-4 flex-wrap text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" />{author}</span>
              {displayMod.version && <span className="font-mono">v{displayMod.version}</span>}
              <span className="flex items-center gap-1"><Download className="w-3.5 h-3.5" />{formatCount(downloads)} {t.nexusDownloads}</span>
              <span className="flex items-center gap-1"><ThumbsUp className="w-3.5 h-3.5" />{formatCount(endorsements)} {t.nexusEndorsements}</span>
              {displayMod.updated_timestamp && (
                <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{formatDate(displayMod.updated_timestamp)}</span>
              )}
              <button onClick={openOnNexus} className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline">
                <ExternalLink className="w-3.5 h-3.5" />{t.nexusVisitPage}
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 pb-8 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">{t.nexusNetworkError}</p>
              <p className="text-xs text-slate-400 font-mono mt-1">{error}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {/* Summary + description */}
              {displayMod.summary && (
                <p className="text-sm text-slate-600 dark:text-slate-300 italic leading-relaxed border-l-3 border-slate-300 dark:border-slate-700 pl-4" style={{ borderLeftWidth: '3px' }}>
                  {displayMod.summary}
                </p>
              )}

              {descriptionHtml && (
                <div
                  className="nexus-description"
                  onClick={handleReadmeClick}
                  dangerouslySetInnerHTML={{ __html: descriptionHtml }}
                />
              )}

              {/* Files */}
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest mb-3 flex items-center gap-2" style={{ color: 'var(--accent-500)' }}>
                  <FileArchive className="w-3.5 h-3.5" />
                  {t.nexusFiles}
                </h3>

                <div className="flex flex-col gap-4">
                  {CATEGORY_ORDER.map(cat => {
                    const list = groupedFiles[cat.id];
                    if (!list || list.length === 0) return null;
                    return (
                      <div key={cat.id}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-[10px] font-black tracking-widest uppercase ${cat.accent ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}>{t[cat.labelKey]}</span>
                          {cat.accent && <Crown className="w-3 h-3 text-amber-500" />}
                          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700/50" />
                        </div>
                        <div className="flex flex-col gap-2">
                          {list.map(file => (
                            <div key={file.file_id} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/50 dark:border-slate-700/50">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{file.name}</span>
                                  {file.version && <span className="text-[10px] font-mono bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded">{file.version}</span>}
                                </div>
                                <div className="flex items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500 mt-1 font-mono">
                                  <span>{formatBytes(file.size_in_bytes || file.size * 1024)}</span>
                                  <span>{formatDate(file.uploaded_timestamp)}</span>
                                  <span className="truncate max-w-[40%]">{file.file_name}</span>
                                </div>
                                {file.description && (
                                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{file.description}</p>
                                )}
                              </div>
                              <button
                                onClick={() => handleInstallFile(file)}
                                disabled={!!installingFileId}
                                className={`shrink-0 flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-full transition-all duration-300 active:scale-95 ${installingFileId ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed' : 'text-white'}`}
                                style={!installingFileId ? { backgroundColor: 'var(--accent-500)', boxShadow: '0 4px 10px -2px rgba(var(--accent-rgb), 0.4)' } : undefined}
                              >
                                {installingFileId === file.file_id
                                  ? <><RefreshCw className="w-3 h-3 animate-spin" /> {t.nexusInstalling}</>
                                  : <><Play className="w-3 h-3 fill-current" /> {t.nexusInstall}</>}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {Object.keys(groupedFiles).length === 0 && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 italic">No downloadable files.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

