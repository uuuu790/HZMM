import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Package, Puzzle, Sliders, FileText, RefreshCw, Link2 } from 'lucide-react';
import { marked } from 'marked';
import { getModIcon, cleanModName } from '../../constants/modIcons';

const ModDetailModal = ({ isOpen, mod, onClose, onOpenConfig, t }) => {
  const [readme, setReadme] = useState(null);
  const [readmeLoading, setReadmeLoading] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);

  const [checkedNoReadme, setCheckedNoReadme] = useState(false);

  useEffect(() => {
    if (!isOpen || !mod || !window.api) return;
    setReadme(null);
    setHasConfig(false);
    setCheckedNoReadme(false);

    const isUe4ss = mod.type === 'UE4SS' || mod.hybrid;
    if (!isUe4ss) return;

    let readmeResult = null;
    let configResult = false;
    let readmeDone = false;
    let configDone = false;

    const tryRedirect = () => {
      if (!readmeDone || !configDone) return;
      // 沒有 README 但有 config → 直接開設定
      if (!readmeResult && configResult && onOpenConfig) {
        onClose();
        setTimeout(() => onOpenConfig(mod), 100);
      } else {
        setCheckedNoReadme(true);
      }
    };

    if (window.api.mods.getReadme) {
      setReadmeLoading(true);
      window.api.mods.getReadme(mod.filename).then(result => {
        readmeResult = result;
        setReadme(result);
        setReadmeLoading(false);
        readmeDone = true;
        tryRedirect();
      }).catch(() => { setReadmeLoading(false); readmeDone = true; tryRedirect(); });
    } else { readmeDone = true; }

    if (window.api.mods.getConfigFiles) {
      window.api.mods.getConfigFiles(mod.filename).then(files => {
        const filtered = (files || []).filter(f =>
          f.name.toLowerCase() !== 'main.lua' &&
          !f.relativePath.toLowerCase().startsWith('scripts/')
        );
        configResult = filtered.length > 0;
        setHasConfig(configResult);
        configDone = true;
        tryRedirect();
      }).catch(() => { configDone = true; tryRedirect(); });
    } else { configDone = true; }
  }, [isOpen, mod]);

  if (!isOpen || !mod) return null;
  // 純 PAK mod 沒有 readme/config，不顯示 modal
  if (mod.type === 'PAK' && !mod.hybrid) return null;

  const iconInfo = getModIcon(mod);
  const IconComponent = iconInfo.icon;
  const title = cleanModName(mod.title || mod.filename);

  // Parse README markdown
  let readmeHtml = null;
  if (readme?.content) {
    let content = readme.content;
    const firstHeading = content.search(/^#\s/m);
    if (firstHeading > 0) content = content.slice(firstHeading);
    content = content.replace(/`([^`\n]+)`/g, '$1');
    readmeHtml = marked.parse(content, { breaks: true });
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm animate-zoom-in duration-300" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-[80vw] max-w-3xl max-h-[80vh] bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border border-white/60 dark:border-slate-700/50 rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] animate-modal-spring flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-5 border-b border-slate-200/60 dark:border-slate-700/50 shrink-0">
          <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${iconInfo.color} border border-white dark:border-white/10 flex items-center justify-center shadow-[0_10px_15px_-3px_rgba(0,0,0,0.05)] dark:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.3)] shrink-0`}>
            <IconComponent className={`w-7 h-7 ${iconInfo.iconColor}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-black text-slate-800 dark:text-white tracking-tight truncate">{title}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                mod.hybrid ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
                : mod.type === 'PAK' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'
                : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
              }`}>
                {mod.hybrid ? <Link2 className="w-2.5 h-2.5" /> : mod.type === 'PAK' ? <Package className="w-2.5 h-2.5" /> : <Puzzle className="w-2.5 h-2.5" />}
                {mod.hybrid ? 'Hybrid' : mod.type}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${mod.enabled ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
                {mod.enabled ? t.enabled || 'ON' : t.disabled || 'OFF'}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 active:scale-90 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full">

          {/* Hybrid links */}
          {mod.hybrid && mod.linkedPaks && (
            <div>
              <h4 className="text-[10px] font-bold text-orange-500 dark:text-orange-400 uppercase tracking-widest mb-1.5">Linked PAK</h4>
              <div className="flex flex-wrap gap-1.5">
                {mod.linkedPaks.map(pak => (
                  <div key={pak} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-50/80 dark:bg-orange-900/10 border border-orange-200/50 dark:border-orange-800/30">
                    <Package className="w-3 h-3 text-orange-500" />
                    <span className="text-[11px] font-mono font-medium text-orange-700 dark:text-orange-300">{pak}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {mod.hybrid && mod.linkedUe4ss && (
            <div>
              <h4 className="text-[10px] font-bold text-orange-500 dark:text-orange-400 uppercase tracking-widest mb-1.5">Linked UE4SS</h4>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-50/80 dark:bg-orange-900/10 border border-orange-200/50 dark:border-orange-800/30 w-fit">
                <Puzzle className="w-3 h-3 text-orange-500" />
                <span className="text-[11px] font-mono font-medium text-orange-700 dark:text-orange-300">{mod.linkedUe4ss}</span>
              </div>
            </div>
          )}

          {/* Readme — only show when content exists */}
          {readmeLoading && (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <RefreshCw className="w-5 h-5 animate-spin" />
            </div>
          )}
          {readmeHtml && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center gap-1.5 mb-2 shrink-0">
                <FileText className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t.readmeTitle}</span>
                <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500">({readme.filename})</span>
              </div>
              <div className="flex-1 rounded-xl border border-slate-200/60 dark:border-slate-700/50 overflow-hidden bg-white/50 dark:bg-slate-800/30">
                <div
                  className="mod-readme px-6 py-5 overflow-y-auto max-h-[50vh] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full"
                  dangerouslySetInnerHTML={{ __html: readmeHtml }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {hasConfig && onOpenConfig && (
          <div className="px-6 py-3.5 border-t border-slate-200/60 dark:border-slate-700/50 flex justify-end shrink-0">
            <button
              onClick={() => { onClose(); setTimeout(() => onOpenConfig(mod), 200); }}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold rounded-full text-white transition-all duration-300 active:scale-95 shadow-sm"
              style={{ backgroundColor: 'var(--accent-500)', boxShadow: '0 10px 15px -3px rgba(var(--accent-rgb), 0.3)' }}
            >
              <Sliders className="w-3.5 h-3.5" />
              {t.configEditBtn}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ModDetailModal;
