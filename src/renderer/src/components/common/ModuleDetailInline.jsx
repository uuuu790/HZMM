import { useState, useEffect } from 'react';
import { Package, Terminal, Sliders, FileText } from 'lucide-react';
import { getModIcon, cleanModName } from '../../constants/modIcons';

const ModuleDetailInline = ({ activeMod, isActive, t, onOpenConfig }) => {
  const [readme, setReadme] = useState(null)
  const [readmeLoading, setReadmeLoading] = useState(false)
  const [hasConfig, setHasConfig] = useState(false)

  useEffect(() => {
    if (isActive && activeMod?.type === 'UE4SS' && window.api) {
      // Check readme
      if (window.api.mods.getReadme) {
        setReadmeLoading(true)
        window.api.mods.getReadme(activeMod.filename).then(result => {
          setReadme(result)
          setReadmeLoading(false)
        }).catch(() => setReadmeLoading(false))
      }
      // Check if config files exist
      if (window.api.mods.getConfigFiles) {
        window.api.mods.getConfigFiles(activeMod.filename).then(files => {
          const filtered = (files || []).filter(f =>
            f.name.toLowerCase() !== 'main.lua' &&
            !f.relativePath.toLowerCase().startsWith('scripts/')
          )
          setHasConfig(filtered.length > 0)
        }).catch(() => setHasConfig(false))
      }
    } else if (!isActive) {
      setReadme(null)
      setHasConfig(false)
    }
  }, [isActive, activeMod?.filename, activeMod?.type])

  const iconInfo = getModIcon(activeMod);
  const IconComponent = iconInfo.icon;

  const title = cleanModName(activeMod.title || activeMod.filename);
  const description = activeMod.description || cleanModName(activeMod.filename) || '';

  return (
    <div className={`grid transition-all duration-500 ease-out ${isActive ? 'grid-rows-[1fr] opacity-100 mt-1 mb-2' : 'grid-rows-[0fr] opacity-0 mt-0 mb-0'}`}>
      <div className="overflow-hidden p-2 -m-2">
        <div className="relative w-full rounded-[1.5rem] md:rounded-[2rem] bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border border-white/60 dark:border-slate-700/50 shadow-md flex flex-col transition-colors duration-700 p-4 md:p-5">

          {activeMod.type === 'UE4SS' && hasConfig && onOpenConfig && (
            <div className="absolute top-3 right-3 md:top-4 md:right-4 z-20">
              <button
                onClick={(e) => { e.stopPropagation(); onOpenConfig(activeMod); }}
                className="h-7 px-2.5 rounded-full flex items-center justify-center gap-1 transition-colors shadow-sm active:scale-95"
                style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.08)', color: 'var(--accent-500)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(var(--accent-rgb), 0.2)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-500)'; e.currentTarget.style.color = 'white'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(var(--accent-rgb), 0.08)'; e.currentTarget.style.color = 'var(--accent-500)'; }}
                title={t.configEditBtn}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold hidden sm:inline">{t.configEditBtn}</span>
              </button>
            </div>
          )}

          <div className="flex flex-col md:flex-row gap-4 md:gap-5 z-10">
            <div className="flex flex-col items-center md:items-start shrink-0">
              <div className={`w-14 h-14 md:w-16 md:h-16 rounded-full bg-gradient-to-br ${iconInfo.color} border border-white dark:border-white/10 flex items-center justify-center shadow-[0_10px_15px_-3px_rgba(0,0,0,0.05)] dark:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.3)] mb-3 transition-colors duration-700`}>
                <IconComponent className={`w-7 h-7 md:w-8 md:h-8 ${iconInfo.iconColor}`} />
              </div>
              <div className="flex flex-col gap-1 w-full px-1">
                {activeMod.type && (
                <div className="flex justify-between text-[10px] md:text-[11px] border-b border-slate-200/50 dark:border-slate-800 pb-1 transition-colors duration-700">
                  <span className="text-slate-500 dark:text-slate-400 font-medium">{t.type}</span>
                  <span className={`flex items-center gap-1 font-bold px-1.5 py-0.5 rounded-full transition-colors duration-700 ${activeMod.type === 'PAK' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400' : 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-400'}`}>
                    {activeMod.type === 'PAK' ? <Package className="w-2.5 h-2.5" /> : <Terminal className="w-2.5 h-2.5" />}
                    {activeMod.type}
                  </span>
                </div>
                )}
                {activeMod.version && (
                  <div className="flex justify-between text-[10px] md:text-[11px] border-b border-slate-200/50 dark:border-slate-800 pb-1 transition-colors duration-700">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">{t.version}</span>
                    <span className="text-slate-700 dark:text-slate-200 font-mono font-bold bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full transition-colors duration-700">{activeMod.version}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col flex-1 min-w-0">
              <h2 className="text-lg md:text-xl font-black text-slate-800 dark:text-white mb-1.5 pr-8 tracking-tight transition-colors duration-700">
                {title}
              </h2>


              <div>
                <h4 className="text-[9px] font-bold text-slate-400 dark:text-slate-500 mb-1 uppercase tracking-widest transition-colors duration-700">{t.authorIntro}</h4>
                <div className="p-2.5 md:p-3 rounded-xl bg-white/40 dark:bg-slate-800/40 border border-slate-200/50 dark:border-slate-700/50 shadow-sm transition-colors duration-700">
                  <p className="text-[11px] md:text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium transition-colors duration-700">
                    {description}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Readme section */}
          {isActive && activeMod?.type === 'UE4SS' && (
            <div className="mt-3">
              {readmeLoading ? (
                <div className="text-[11px] text-slate-400 dark:text-slate-500 font-medium animate-pulse">{t.readmeTitle}...</div>
              ) : readme ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{t.readmeTitle}</span>
                    <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500">({readme.filename})</span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200/60 dark:border-slate-700/50 overflow-hidden">
                    <div className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap font-mono [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400/80 dark:hover:[&::-webkit-scrollbar-thumb]:bg-slate-600/80">
                      {readme.content}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-slate-400 dark:text-slate-500 font-medium italic">{t.readmeNone}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ModuleDetailInline;
