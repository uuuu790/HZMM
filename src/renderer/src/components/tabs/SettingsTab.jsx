import React, { useState } from 'react';
import GlassCard from '../common/GlassCard';
import { THEME_PRESETS } from '../../constants/themes';
import { Settings, Sun, Moon, Sliders, Folder, RefreshCw, AlertTriangle, FileText, Info, DownloadCloud, CheckCircle, Zap, Save, RotateCcw, Trash2, Package, KeyRound, ChevronDown, Globe } from 'lucide-react';
import { formatBytes } from '../common/utils';

function SettingsTab({
  t,
  lang,
  isDark,
  themeId,
  toggleDark,
  changeTheme,
  gamePath,
  detecting,
  handleDetectPath,
  handleBrowsePath,
  handleConflictScan,
  handleOpenLogs,
  handleRescan,
  rescanning,
  appVersion,
  updateState,
  updateInfo,
  updateProgress,
  handleCheckUpdate,
  handleDownloadUpdate,
  handleInstallUpdate,
  backups,
  backupLoading,
  handleBackup,
  handleListBackups,
  handleRestoreBackup,
  handleDeleteBackup,
  nexusApiKey,
  handleSetNexusApiKey,
}) {
  const [expandedBackup, setExpandedBackup] = useState(null);

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="flex items-center gap-3 mb-3 px-4 animate-slide-up duration-500">
        <div className="p-2 rounded-full bg-slate-200/60 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 shadow-inner transition-colors duration-700">
          <Settings className="w-5 h-5 animate-[spin_6s_linear_infinite]" />
        </div>
        <h3 className="text-xl font-black text-slate-800 dark:text-slate-100 tracking-wide transition-colors duration-700">{lang === 'zh-TW' ? '系統' : ''}{t.settings}</h3>
      </div>

      <div className="flex flex-col gap-3 px-2">

        {/* Dark mode toggle */}
        <div className="animate-slide-up" style={{ animationFillMode: 'both', animationDelay: '0ms', animationDuration: '600ms' }}>
          <GlassCard
            onClick={toggleDark}
            className="group flex flex-row items-center px-4 py-2 md:px-5 md:py-2.5 gap-4 relative"
          >
            <div className="p-2.5 rounded-full border shrink-0 transition-all duration-500 shadow-sm group-hover:scale-110 group-hover:-rotate-12"
              style={{ backgroundColor: isDark ? 'rgba(var(--accent-rgb), 0.15)' : 'var(--accent-100)', borderColor: isDark ? 'rgba(var(--accent-rgb), 0.3)' : 'var(--accent-200)', color: isDark ? 'var(--accent-400)' : 'var(--accent-500)' }}>
              {isDark ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </div>
            <div className="flex flex-col flex-1 min-w-0 transition-opacity duration-300">
              <div className="flex items-center gap-3 mb-0.5">
                <h4 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight transition-colors duration-700">{t.appearance}</h4>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 leading-none transition-colors duration-700 shadow-inner">
                  {isDark ? t.darkMode : t.lightMode}
                </span>
              </div>
              <p className="text-[11px] md:text-xs text-slate-500 dark:text-slate-400 truncate font-medium transition-colors duration-700">{t.appearanceDesc}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); toggleDark(); }}
                className="relative flex items-center w-16 h-8 md:w-20 md:h-9 bg-slate-200/80 dark:bg-slate-950/60 rounded-full p-1 shadow-inner transition-colors duration-500 hover:scale-105 active:scale-95"
              >
                <div
                  className={`absolute top-1 bottom-1 w-[28px] md:w-[36px] bg-white dark:bg-slate-700 rounded-full shadow-md transition-transform duration-500 ${isDark ? 'translate-x-[28px] md:translate-x-[36px]' : 'translate-x-0'}`}
                  style={{ transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                />
                <div className={`relative flex-1 flex justify-center items-center z-10 transition-colors duration-500 ${!isDark ? '' : 'text-slate-400 dark:text-slate-600'}`}
                  style={!isDark ? { color: 'var(--accent-500)' } : undefined}><Sun className="w-3.5 h-3.5 md:w-4 md:h-4" /></div>
                <div className={`relative flex-1 flex justify-center items-center z-10 transition-colors duration-500 ${isDark ? 'text-indigo-400' : 'text-slate-400 dark:text-slate-600'}`}><Moon className="w-3.5 h-3.5 md:w-4 md:h-4" /></div>
              </button>
            </div>
          </GlassCard>
        </div>

        {/* Theme selector */}
        <div className="animate-slide-up" style={{ animationFillMode: 'both', animationDelay: '50ms', animationDuration: '600ms' }}>
          <GlassCard isPill={false} className="group flex flex-col px-4 py-3 md:px-5 md:py-3.5 gap-3 relative">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl border shrink-0 transition-all duration-500 shadow-sm group-hover:scale-110"
                style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.1)', borderColor: 'rgba(var(--accent-rgb), 0.2)', color: 'var(--accent-500)' }}>
                <Sliders className="w-5 h-5" />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <h4 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight transition-colors duration-700">{t.theme}</h4>
                <p className="text-[11px] md:text-xs text-slate-500 dark:text-slate-400 truncate font-medium transition-colors duration-700">{t.themeDesc}</p>
              </div>
            </div>
            <div className="flex items-center justify-around gap-3 px-2 py-1">
              {THEME_PRESETS.map(preset => {
                const isActive = themeId === preset.id;
                const label = t[`theme${preset.id.charAt(0).toUpperCase() + preset.id.slice(1)}`] || preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={(e) => changeTheme(preset.id, e)}
                    className={`flex flex-col items-center gap-2 px-3 py-2 rounded-2xl transition-all duration-300 active:scale-90 ${isActive ? 'bg-white/80 dark:bg-slate-800/80 shadow-md scale-105' : 'hover:bg-white/40 dark:hover:bg-slate-800/40 hover:scale-105'}`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg transition-all duration-300 shadow-sm ${isActive ? 'scale-110' : 'hover:scale-110'}`}
                      style={{
                        background: `linear-gradient(135deg, ${preset.accent[400]}, ${preset.gradient.to})`,
                        boxShadow: isActive ? `0 0 0 2.5px ${isDark ? '#0f172a' : '#fff'}, 0 0 0 4.5px ${preset.accent[500]}` : undefined
                      }}
                    />
                    <span className={`text-xs font-bold tracking-wide transition-colors duration-300 ${isActive ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>{label}</span>
                  </button>
                );
              })}
            </div>
          </GlassCard>
        </div>

        {/* Game path */}
        <div className="animate-slide-up" style={{ animationFillMode: 'both', animationDelay: '150ms', animationDuration: '600ms' }}>
          <GlassCard className="group flex flex-row items-center px-4 py-2 md:px-5 md:py-2.5 gap-2 md:gap-4 relative">
            <div className="p-2.5 rounded-full border shrink-0 transition-all duration-500 shadow-sm group-hover:scale-110 group-hover:rotate-6"
              style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.15)', borderColor: 'rgba(var(--accent-rgb), 0.3)', color: 'var(--accent-500)' }}>
              <Folder className="w-5 h-5" />
            </div>
            <div className="flex flex-col flex-1 min-w-0 transition-opacity duration-300">
              <div className="flex items-center gap-2 mb-0.5">
                <h4 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight transition-colors duration-700">{t.gamePath}</h4>
              </div>
              <p className="text-[10px] md:text-[11px] text-slate-500 dark:text-slate-400 truncate font-medium transition-colors duration-700">{t.gamePathDesc}</p>
            </div>
            <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
              <input
                type="text"
                value={gamePath || ''}
                readOnly
                placeholder={t.gamePathPlaceholder || '...'}
                className="w-16 sm:w-28 md:w-48 px-3 py-1.5 text-[10px] md:text-xs rounded-full bg-white/50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all shadow-inner font-mono truncate hover:bg-white/80 dark:hover:bg-slate-900/80"
              />
              <button
                onClick={handleDetectPath}
                disabled={detecting}
                className={`px-2.5 md:px-3 py-1.5 text-[10px] md:text-xs font-bold rounded-full transition-all duration-300 shadow-sm flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-sky-500 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/30 active:scale-95 hover:shadow-md ${detecting ? 'opacity-70 pointer-events-none' : ''}`}
                title={t.gamePathDetect}
              >
                <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 transition-transform ${detecting ? 'animate-spin' : ''}`} />
                <span className="hidden lg:inline ml-1.5">{t.gamePathDetect}</span>
              </button>
              <button onClick={handleBrowsePath} className="px-3 py-1.5 text-[10px] md:text-xs font-bold rounded-full transition-all duration-300 shadow-sm flex items-center justify-center min-w-[3.5rem] md:min-w-[4rem] bg-slate-800 dark:bg-slate-700 text-white hover:bg-sky-500 dark:hover:bg-sky-500 active:scale-95 hover:shadow-[0_10px_15px_-3px_rgba(14,165,233,0.3)]">
                {t.gamePathBrowse}
              </button>
            </div>
          </GlassCard>
        </div>

        {/* Nexus Mods API Key */}
        <div className="animate-slide-up" style={{ animationFillMode: 'both', animationDelay: '200ms', animationDuration: '600ms' }}>
          <GlassCard className="group flex flex-row items-center px-4 py-2 md:px-5 md:py-2.5 gap-2 md:gap-4 relative">
            <div className="p-2.5 rounded-full border shrink-0 transition-all duration-500 shadow-sm group-hover:scale-110 group-hover:-rotate-6"
              style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.15)', borderColor: 'rgba(var(--accent-rgb), 0.3)', color: 'var(--accent-500)' }}>
              <KeyRound className="w-5 h-5" />
            </div>
            <div className="flex flex-col flex-1 min-w-0 transition-opacity duration-300">
              <div className="flex items-center gap-2 mb-0.5">
                <h4 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight transition-colors duration-700">{t.nexusApiKey || 'Nexus Mods API Key'}</h4>
                {nexusApiKey && (
                  <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50 shadow-inner">
                    <CheckCircle className="w-3 h-3" /> {t.installed || 'Set'}
                  </span>
                )}
              </div>
              <p className="text-[10px] md:text-[11px] text-slate-500 dark:text-slate-400 truncate font-medium transition-colors duration-700">{t.nexusApiKeyDesc || 'Required for downloading mods from Nexus Mods URLs'}</p>
            </div>
            <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
              <input
                type="password"
                value={nexusApiKey}
                onChange={(e) => handleSetNexusApiKey(e.target.value)}
                placeholder="API Key..."
                className="w-24 sm:w-32 md:w-48 px-3 py-1.5 text-[10px] md:text-xs rounded-full bg-white/50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all shadow-inner font-mono truncate hover:bg-white/80 dark:hover:bg-slate-900/80"
              />
              <button
                onClick={() => window.api?.system?.openExternal('https://next.nexusmods.com/settings/api-keys')}
                className="px-3 py-1.5 text-[10px] md:text-xs font-bold rounded-full transition-all duration-300 shadow-sm flex items-center justify-center bg-slate-800 dark:bg-slate-700 text-white hover:bg-orange-500 dark:hover:bg-orange-500 active:scale-95 hover:shadow-[0_10px_15px_-3px_rgba(249,115,22,0.3)]"
              >
                {t.nexusGetKey || 'Get Key'}
              </button>
            </div>
          </GlassCard>
        </div>

        {/* Tools row: Conflict Scan + View Logs + Rescan Mods */}
        <div className="animate-slide-up" style={{ animationFillMode: 'both', animationDelay: '300ms', animationDuration: '600ms' }}>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleConflictScan} className="flex items-center gap-2 px-4 py-2.5 bg-white/60 dark:bg-slate-800/60 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-full text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:border-amber-300 dark:hover:border-amber-700 hover:text-amber-600 dark:hover:text-amber-400 transition-all duration-300 active:scale-95 shadow-sm hover:shadow-md">
              <AlertTriangle className="w-4 h-4" /> {t.conflictScan}
            </button>
            <button onClick={handleOpenLogs} className="flex items-center gap-2 px-4 py-2.5 bg-white/60 dark:bg-slate-800/60 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-full text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-sky-900/20 hover:border-sky-300 dark:hover:border-sky-700 hover:text-sky-600 dark:hover:text-sky-400 transition-all duration-300 active:scale-95 shadow-sm hover:shadow-md">
              <FileText className="w-4 h-4" /> {t.viewLogs}
            </button>
            <button onClick={handleRescan} disabled={rescanning} className={`flex items-center gap-2 px-4 py-2.5 bg-white/60 dark:bg-slate-800/60 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-full text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:border-violet-300 dark:hover:border-violet-700 hover:text-violet-600 dark:hover:text-violet-400 transition-all duration-300 active:scale-95 shadow-sm hover:shadow-md ${rescanning ? 'opacity-70 pointer-events-none' : ''}`}>
              <RefreshCw className={`w-4 h-4 ${rescanning ? 'animate-spin' : ''}`} /> {rescanning ? t.rescanning : t.rescanMods}
            </button>
          </div>
        </div>

        {/* World Save Backup */}
        <div className="animate-slide-up" style={{ animationFillMode: 'both', animationDelay: '350ms', animationDuration: '600ms' }}>
          <GlassCard isPill={false} className="group flex flex-col px-4 py-3 md:px-5 md:py-4 gap-3 relative">
            <div className="flex items-center gap-4">
              <div className="p-2.5 rounded-xl border shrink-0 transition-all duration-500 shadow-sm group-hover:scale-110 group-hover:rotate-6"
                style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.15)', borderColor: 'rgba(var(--accent-rgb), 0.3)', color: 'var(--accent-500)' }}>
                <Save className="w-5 h-5" />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <h4 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight transition-colors duration-700">{t.backup}</h4>
                <p className="text-[11px] md:text-xs text-slate-500 dark:text-slate-400 font-medium transition-colors duration-700">{t.backupDesc}</p>
              </div>
              <button
                onClick={handleBackup}
                disabled={backupLoading}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-full text-white transition-all duration-300 active:scale-95 shadow-sm disabled:opacity-60"
                style={{ backgroundColor: 'var(--accent-500)' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--accent-600)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(var(--accent-rgb), 0.3)'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--accent-500)'; e.currentTarget.style.boxShadow = ''; }}
              >
                {backupLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {t.backupCreate}
              </button>
            </div>

            {/* Backup list */}
            {backups.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {backups.filter(b => !b.legacy).map((backup, i) => {
                  const isExpanded = expandedBackup === (backup.name || i);
                  const worldNames = backup.worlds?.map(w => w.name) || [];
                  const totalSize = backup.totalSize || 0;
                  const modCount = backup.mods?.length || 0;
                  return (
                    <div key={backup.name || i} className="flex flex-col rounded-xl bg-slate-50/80 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 transition-all duration-300 hover:bg-white/80 dark:hover:bg-slate-800/50 animate-slide-up overflow-hidden" style={{ animationFillMode: 'both', animationDelay: `${i * 50}ms`, animationDuration: '400ms' }}>
                      <div className="flex items-center gap-3 px-3 py-2.5 cursor-pointer" onClick={() => setExpandedBackup(isExpanded ? null : (backup.name || i))}>
                        <ChevronDown className={`w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0 transition-transform duration-300 ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">
                            {backup.date ? new Date(backup.date).toLocaleString() : backup.timestamp?.replace(/T/g, ' ').replace(/-/g, '/').slice(0, 19)}
                          </span>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {worldNames.map((name, j) => (
                              <span key={j} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full" style={{ color: 'var(--accent-500)', backgroundColor: 'rgba(var(--accent-rgb), 0.1)' }}>
                                <Globe className="w-2.5 h-2.5" />{name}
                              </span>
                            ))}
                            {totalSize > 0 && <span className="text-[9px] text-slate-400 dark:text-slate-500">{formatBytes(totalSize)}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRestoreBackup(backup.path); }}
                            className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-full transition-all duration-300 active:scale-95 hover:shadow-sm"
                            style={{ color: 'var(--accent-500)', backgroundColor: 'rgba(var(--accent-rgb), 0.08)', border: '1px solid rgba(var(--accent-rgb), 0.2)' }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(var(--accent-rgb), 0.15)'; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(var(--accent-rgb), 0.08)'; }}
                          >
                            <RotateCcw className="w-3 h-3" />
                            {t.backupRestore}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteBackup(backup.path); }}
                            className="p-1.5 rounded-full text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/20 transition-all duration-300 hover:scale-110 active:scale-95"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      {/* Expanded: worlds + mods at backup time */}
                      <div className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                        <div className="overflow-hidden">
                          <div className="px-3 pb-2.5 pt-0.5 flex flex-col gap-1.5 border-t border-slate-100 dark:border-slate-800">
                            {backup.worlds?.length > 0 && (
                              <div className="flex flex-col gap-0.5">
                                <span className="text-[9px] font-bold flex items-center gap-1 mt-1" style={{ color: 'var(--accent-500)' }}><Globe className="w-2.5 h-2.5" />{t.backupWorlds || 'Worlds'}</span>
                                {backup.worlds.map((w, j) => (
                                  <div key={j} className="flex items-center justify-between pl-4">
                                    <span className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">{w.name}</span>
                                    <span className="text-[9px] text-slate-400">{formatBytes(w.files?.reduce((s, f) => s + (f.size || 0), 0) || 0)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {modCount > 0 && (
                              <div className="flex flex-col gap-0.5">
                                <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-1"><Package className="w-2.5 h-2.5" />{t.backupModsAtTime || 'Mods at backup time'} ({modCount})</span>
                                {backup.mods.map((mod, j) => (
                                  <div key={j} className="flex items-center gap-1.5 pl-4">
                                    <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${mod.type?.toUpperCase() === 'PAK' ? 'text-indigo-500 bg-indigo-500/10' : 'text-rose-500 bg-rose-500/10'}`}>{mod.type?.toUpperCase() === 'PAK' ? 'PAK' : 'UE4SS'}</span>
                                    <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{mod.title || mod.filename}</span>
                                    {!mod.enabled && <span className="text-[8px] text-slate-400 italic">disabled</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                            {!backup.worlds?.length && !modCount && (
                              <span className="text-[10px] text-slate-400 dark:text-slate-500 italic py-1">{t.backupEmpty}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>
        </div>

        {/* About / Update */}
        <div className="animate-slide-up" style={{ animationFillMode: 'both', animationDelay: '450ms', animationDuration: '600ms' }}>
          <GlassCard isPill={!(updateState === 'available' && updateInfo?.changelog)} className="flex flex-col px-4 py-3 md:px-5 md:py-4 gap-3 relative">
            <div className="flex items-center gap-4">
              <div className="p-2.5 rounded-full border shrink-0 transition-all duration-500 shadow-sm bg-slate-100 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400">
                <Info className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-0.5">
                  <h4 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight transition-colors duration-700">{t.about}</h4>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 shadow-inner">v{appVersion || '1.0.0'}</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium transition-colors duration-700">HZMM — HumanitZ Mod Manager</p>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                {updateState === 'idle' && (
                  <button onClick={handleCheckUpdate} className="px-4 py-2 text-xs font-bold rounded-full bg-slate-800 dark:bg-slate-700 text-white transition-all duration-300 active:scale-95 shadow-sm hover:shadow-md"
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-500)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}>
                    {t.checkUpdate}
                  </button>
                )}
                {updateState === 'checking' && (
                  <span className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {t.checking}
                  </span>
                )}
                {updateState === 'latest' && (
                  <span className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 rounded-full border border-emerald-200 dark:border-emerald-800">
                    <CheckCircle className="w-3.5 h-3.5" /> {t.latestVersion}
                  </span>
                )}
                {updateState === 'available' && (
                  <button onClick={handleDownloadUpdate} className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-full text-white transition-all duration-300 active:scale-95 shadow-sm" style={{ backgroundColor: 'var(--accent-500)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-600)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(var(--accent-rgb), 0.3)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-500)'; e.currentTarget.style.boxShadow = ''; }}>
                    <DownloadCloud className="w-3.5 h-3.5" /> {t.downloadUpdate}
                  </button>
                )}
                {updateState === 'downloading' && (
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-2 bg-slate-200/80 dark:bg-slate-800/80 rounded-full overflow-hidden shadow-inner">
                      <div className="h-full transition-all duration-500 ease-out rounded-full shimmer-sweep" style={{ background: 'linear-gradient(to right, var(--accent-400), var(--accent-500))', width: `${updateProgress}%` }} />
                    </div>
                    <span className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--accent-500)' }}>{Math.round(updateProgress)}%</span>
                  </div>
                )}
                {updateState === 'ready' && (
                  <button onClick={handleInstallUpdate} className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-full bg-emerald-500 hover:bg-emerald-600 text-white transition-all duration-300 active:scale-95 shadow-sm hover:shadow-md">
                    <Zap className="w-3.5 h-3.5" /> {t.installUpdate}
                  </button>
                )}
              </div>
            </div>
            {updateState === 'available' && updateInfo?.changelog && (
              <div className="mt-1 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200/60 dark:border-slate-700/50 overflow-hidden">
              <div className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed max-h-28 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400/80 dark:hover:[&::-webkit-scrollbar-thumb]:bg-slate-600/80">
                <p className="font-bold text-slate-600 dark:text-slate-300 mb-1.5">{t.newVersion}: {updateInfo.latestVersion.startsWith('v') ? updateInfo.latestVersion : `v${updateInfo.latestVersion}`}</p>
                {updateInfo.changelog.split('\n').map((line, i) => {
                  const trimmed = line.trim();
                  if (!trimmed) return null;
                  if (trimmed.startsWith('## ')) return <p key={i} className="font-bold text-slate-600 dark:text-slate-300 mt-1.5 mb-0.5">{trimmed.replace('## ', '')}</p>;
                  if (trimmed.startsWith('- ')) return <p key={i} className="pl-2">• {trimmed.replace('- ', '')}</p>;
                  return <p key={i}>{trimmed}</p>;
                })}
              </div>
              </div>
            )}
          </GlassCard>
        </div>

      </div>
    </div>
  );
}

export default SettingsTab;
