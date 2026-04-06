import React, { useState, useMemo, useCallback } from 'react';
import { Package, Terminal, Search, Filter, ArrowUpDown, CheckSquare, Square, X, ChevronDown, CheckCircle, Power, Trash2 } from 'lucide-react';
import ModuleList from '../common/ModuleList';
import GlassCard from '../common/GlassCard';
import { getModIcon, cleanModName } from '../../constants/modIcons';

function ModulesTab({
  t,
  lang,
  modules,
  activeModuleId,
  handleModuleClick,
  handleToggleEnable,
  handleUninstallLocalMod,
  setConfigEditorMod,
  newlyInstalledMods,
  isGameRunning,
  showConfirm,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [selectedMods, setSelectedMods] = useState(new Set());
  const [batchMode, setBatchMode] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const filteredModules = useMemo(() => {
    let result = [...modules];

    // Filter by type
    if (filterType !== 'all') {
      result = result.filter(m => m.type === filterType);
    }

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(m =>
        m.title.toLowerCase().includes(q) ||
        m.filename.toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case 'name': return a.title.localeCompare(b.title);
        case 'type': return a.type.localeCompare(b.type) || a.title.localeCompare(b.title);
        case 'status': return (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0) || a.title.localeCompare(b.title);
        case 'newest': return new Date(b.modified) - new Date(a.modified);
        default: return 0;
      }
    });

    return result;
  }, [modules, filterType, searchQuery, sortBy]);

  const toggleBatchMode = useCallback(() => {
    setBatchMode(prev => {
      if (prev) setSelectedMods(new Set());
      return !prev;
    });
  }, []);

  const toggleSelect = useCallback((modKey) => {
    setSelectedMods(prev => {
      const next = new Set(prev);
      if (next.has(modKey)) next.delete(modKey);
      else next.add(modKey);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedMods(new Set(filteredModules.map(m => m.id || m.filename)));
  }, [filteredModules]);

  const deselectAll = useCallback(() => {
    setSelectedMods(new Set());
  }, []);

  const guardGameRunning = useCallback((action) => {
    if (isGameRunning) {
      showConfirm(
        t.gameRunningTitle || 'Game Running',
        t.gameRunningDesc || 'The game is currently running. Modifying mods may cause issues.',
        action
      );
    } else {
      action();
    }
  }, [isGameRunning, showConfirm, t]);

  const batchEnable = useCallback(() => {
    guardGameRunning(() => {
      selectedMods.forEach(key => {
        const mod = modules.find(m => (m.id || m.filename) === key);
        if (mod && !mod.enabled) handleToggleEnable(mod.filename);
      });
    });
  }, [guardGameRunning, selectedMods, modules, handleToggleEnable]);

  const batchDisable = useCallback(() => {
    guardGameRunning(() => {
      selectedMods.forEach(key => {
        const mod = modules.find(m => (m.id || m.filename) === key);
        if (mod && mod.enabled) handleToggleEnable(mod.filename);
      });
    });
  }, [guardGameRunning, selectedMods, modules, handleToggleEnable]);

  const batchDelete = useCallback(() => {
    guardGameRunning(() => {
      showConfirm(
        t.batchDelete || 'Delete Selected',
        `${t.confirmDeleteCount || 'Delete'} ${selectedMods.size} ${t.mods || 'mods'}?`,
        () => {
          selectedMods.forEach(key => {
            const mod = modules.find(m => (m.id || m.filename) === key);
            if (mod) handleUninstallLocalMod(mod.filename);
          });
          setSelectedMods(new Set());
        }
      );
    });
  }, [guardGameRunning, showConfirm, selectedMods, modules, handleUninstallLocalMod, t]);

  const sortOptions = [
    { value: 'name', label: t.sortName || 'Name' },
    { value: 'type', label: t.sortType || 'Type' },
    { value: 'status', label: t.sortStatus || 'Status' },
    { value: 'newest', label: t.sortNewest || 'Newest' },
  ];

  const filterPills = [
    { value: 'all', label: t.filterAll || 'All' },
    { value: 'PAK', label: 'PAK' },
    { value: 'UE4SS', label: 'UE4SS' },
  ];

  const isGroupedView = filterType === 'all' && !batchMode && !searchQuery;

  const renderFlatCard = (mod, index) => {
    const iconInfo = getModIcon(mod);
    const modKey = mod.id || mod.filename;
    const isSelected = selectedMods.has(modKey);

    return (
      <div
        key={modKey}
        className="animate-slide-up"
        style={{ animationFillMode: 'both', animationDelay: `${index * 40}ms`, animationDuration: '500ms' }}
      >
        <GlassCard
          isPill={false}
          onClick={() => {
            if (batchMode) {
              toggleSelect(modKey);
            } else {
              handleModuleClick(modKey);
            }
          }}
          className={`group flex flex-row items-center px-3 py-2 md:px-4 md:py-2.5 gap-3 md:gap-4 !rounded-2xl
            ${activeModuleId === modKey && !batchMode ? 'bg-white/80 dark:bg-slate-800/80' : ''}
            ${isSelected && batchMode ? 'ring-2' : ''}
            ${newlyInstalledMods?.has(modKey) ? 'ring-2' : ''}
          `}
          style={{
            ...(activeModuleId === modKey && !batchMode ? { boxShadow: '0 0 0 2px rgba(var(--accent-rgb), 0.5)' } : {}),
            ...(isSelected && batchMode ? { '--tw-ring-color': 'rgba(var(--accent-rgb), 0.6)' } : {}),
            ...(newlyInstalledMods?.has(modKey) ? { '--tw-ring-color': 'rgba(var(--accent-rgb), 0.6)', animation: 'newModPulse 0.8s ease-out 2' } : {}),
          }}
        >
          {/* Batch checkbox */}
          {batchMode && (
            <div className="shrink-0 transition-all duration-300">
              {isSelected ? (
                <CheckSquare className="w-5 h-5 transition-transform duration-200 active:scale-90" style={{ color: 'var(--accent-500)' }} />
              ) : (
                <Square className="w-5 h-5 text-slate-400 dark:text-slate-500 transition-transform duration-200 hover:scale-110" />
              )}
            </div>
          )}

          {/* Icon */}
          <div className={`w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-full bg-gradient-to-br ${iconInfo.color} border border-white dark:border-white/10 shrink-0 transition-all duration-300 shadow-sm group-hover:scale-105 group-hover:shadow-md ${!mod.enabled ? 'opacity-50 grayscale' : ''}`}>
            <iconInfo.icon className={`w-4 h-4 md:w-5 md:h-5 ${iconInfo.iconColor}`} />
          </div>

          {/* Info */}
          <div className={`flex flex-col flex-1 min-w-0 transition-opacity duration-300 ${!mod.enabled ? 'opacity-60' : ''}`}>
            <div className="flex items-center gap-2 mb-0.5">
              <h4 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight transition-colors duration-700">{cleanModName(mod.title || mod.filename)}</h4>
              <span className="text-[9px] text-slate-500 dark:text-slate-400 font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 leading-none transition-colors duration-700">{mod.version || mod.type}</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-medium transition-colors duration-700">{mod.description || mod.filename}</p>
          </div>

          {/* Actions (hidden in batch mode) */}
          {!batchMode && (
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1.5 md:gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleUninstallLocalMod(mod.filename); }}
                  className="p-1.5 rounded-full text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/20 transition-all duration-300 hover:scale-110 active:scale-95"
                  title={t.uninstall}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                <span className={`hidden sm:flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors duration-300 ${mod.enabled ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'}`}>
                  {mod.enabled ? <CheckCircle className="w-3 h-3" /> : <Power className="w-3 h-3" />}
                  {mod.enabled ? t.running : t.disabled}
                </span>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const knob = e.currentTarget.querySelector('.toggle-knob');
                    if (knob) { knob.classList.remove('toggle-bounce'); void knob.offsetWidth; knob.classList.add('toggle-bounce'); }
                    handleToggleEnable(mod.filename);
                  }}
                  className={`relative inline-flex h-4 w-8 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner border border-black/5 dark:border-white/5 active:scale-90 ${!mod.enabled ? 'bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600' : ''}`}
                  style={mod.enabled ? { backgroundColor: 'var(--accent-500)' } : undefined}
                >
                  <span className={`toggle-knob inline-block h-3 w-3 transform rounded-full bg-white transition duration-300 ease-in-out shadow-[0_2px_4px_rgba(0,0,0,0.2)] ${mod.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                </button>
              </div>
              <div className={`p-1.5 rounded-full transition-all duration-300 ${activeModuleId !== modKey ? 'bg-transparent group-hover:bg-slate-100 dark:group-hover:bg-slate-800 text-slate-400 dark:text-slate-500' : ''}`} style={activeModuleId === modKey ? { backgroundColor: 'rgba(var(--accent-rgb), 0.1)', color: 'var(--accent-500)' } : undefined}>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-500 ease-out ${activeModuleId === modKey ? 'rotate-180' : 'rotate-0 group-hover:translate-y-px'}`} />
              </div>
            </div>
          )}
        </GlassCard>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2 w-full animate-slide-up">
      {/* Toolbar: Search + Filter + Sort + Batch Toggle */}
      <div className="flex flex-wrap items-center gap-2 mb-2 px-2">
        {/* Search input */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.searchPlaceholder || 'Search mods...'}
            className="w-full pl-9 pr-8 py-1.5 text-sm rounded-full
              bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl
              border border-white/80 dark:border-white/10
              text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500
              shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.15)]
              focus:outline-none focus:border-[var(--accent-400)] focus:ring-1 focus:ring-[var(--accent-400)]
              transition-all duration-300"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors duration-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-1 p-0.5 rounded-full bg-white/40 dark:bg-slate-900/40 border border-white/60 dark:border-white/5">
          {filterPills.map(pill => (
            <button
              key={pill.value}
              onClick={() => setFilterType(pill.value)}
              className={`px-3 py-1 text-xs font-bold rounded-full transition-all duration-300 outline-none
                ${filterType === pill.value
                  ? 'text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-800/50'
                }
              `}
              style={filterType === pill.value ? { backgroundColor: 'var(--accent-500)' } : undefined}
            >
              {pill.label}
            </button>
          ))}
        </div>

        {/* Sort dropdown */}
        <div className="relative">
          <button
            onClick={() => setSortOpen(!sortOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-full
              bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl
              border border-white/80 dark:border-white/10
              text-slate-600 dark:text-slate-300
              shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.15)]
              hover:bg-white/80 dark:hover:bg-slate-800/80
              transition-all duration-300 outline-none"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            {sortOptions.find(o => o.value === sortBy)?.label}
            <ChevronDown className={`w-3 h-3 transition-transform duration-300 ${sortOpen ? 'rotate-180' : ''}`} />
          </button>
          {sortOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setSortOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-40 min-w-[120px] py-1 rounded-xl
                bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl
                border border-white/80 dark:border-white/10
                shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)]
                animate-slide-up"
                style={{ animationDuration: '200ms' }}
              >
                {sortOptions.map(option => (
                  <button
                    key={option.value}
                    onClick={() => { setSortBy(option.value); setSortOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-xs font-medium transition-colors duration-200 outline-none
                      ${sortBy === option.value
                        ? 'font-bold'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }
                    `}
                    style={sortBy === option.value ? { color: 'var(--accent-500)' } : undefined}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Batch mode toggle */}
        <button
          onClick={toggleBatchMode}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-full
            border transition-all duration-300 outline-none
            ${batchMode
              ? 'text-white border-transparent shadow-sm'
              : 'bg-white/60 dark:bg-slate-900/60 border-white/80 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-white/80 dark:hover:bg-slate-800/80 shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.15)]'
            }
          `}
          style={batchMode ? { backgroundColor: 'var(--accent-500)' } : undefined}
        >
          <CheckSquare className="w-3.5 h-3.5" />
          {batchMode ? t.batchModeOn || 'Batch' : t.batchModeOff || 'Batch'}
        </button>
      </div>

      {/* Module count */}
      <div className="px-4 text-xs text-slate-500 dark:text-slate-400 transition-colors duration-700">
        {filteredModules.length} / {modules.length} {t.installed || 'installed'}
      </div>

      {/* Content */}
      {modules.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-slate-400 dark:text-slate-500 gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-full" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.1)', animation: 'emptyBreath 3s ease-in-out infinite' }} />
            <Package className="relative w-14 h-14 opacity-40" style={{ animation: 'emptyBreath 3s ease-in-out infinite' }} />
          </div>
          <h3 className="text-lg font-bold animate-slide-up" style={{ animationDelay: '100ms' }}>{t.noMods}</h3>
          <p className="text-sm animate-slide-up" style={{ animationDelay: '200ms' }}>{t.noModsDesc}</p>
        </div>
      ) : filteredModules.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[20vh] text-slate-400 dark:text-slate-500 gap-2 animate-slide-up">
          <Search className="w-10 h-10 opacity-30" />
          <p className="text-sm font-medium">{t.noResults || 'No mods found'}</p>
        </div>
      ) : isGroupedView ? (
        /* Original grouped view with PAK and UE4SS sections */
        <>
          <ModuleList
            modules={modules}
            type="PAK"
            title={t.pakTitle}
            icon={Package}
            colorClass="text-indigo-600 dark:text-indigo-400"
            activeModuleId={activeModuleId}
            onModuleClick={handleModuleClick}
            onToggle={handleToggleEnable}
            onUninstallLocal={handleUninstallLocalMod}
            onOpenConfig={setConfigEditorMod}
            t={t}
            lang={lang}
            newlyInstalledMods={newlyInstalledMods}
          />
          {modules.some(m => m.type === 'PAK') && modules.some(m => m.type === 'UE4SS') && (
            <div className="w-full h-px bg-slate-200/60 dark:bg-white/10 my-4 rounded-full transition-colors duration-700" />
          )}
          <ModuleList
            modules={modules}
            type="UE4SS"
            title={t.ue4ssTitle}
            icon={Terminal}
            colorClass="text-rose-600 dark:text-rose-400"
            activeModuleId={activeModuleId}
            onModuleClick={handleModuleClick}
            onToggle={handleToggleEnable}
            onUninstallLocal={handleUninstallLocalMod}
            onOpenConfig={setConfigEditorMod}
            t={t}
            lang={lang}
            newlyInstalledMods={newlyInstalledMods}
          />
        </>
      ) : (
        /* Flat filtered/sorted list */
        <div className="flex flex-col gap-2.5 px-2">
          {filteredModules.map((mod, index) => renderFlatCard(mod, index))}
        </div>
      )}

      {/* Batch action bar */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 transition-all duration-500 ease-out
          ${batchMode && selectedMods.size > 0 ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}
        `}
      >
        <div className="mx-auto max-w-3xl px-4 pb-4">
          <div className="flex items-center gap-2 px-4 py-3 rounded-2xl
            bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl
            border border-white/80 dark:border-white/10
            shadow-[0_-4px_30px_rgba(0,0,0,0.1)] dark:shadow-[0_-4px_30px_rgba(0,0,0,0.4)]"
          >
            {/* Selected count */}
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200 mr-2 whitespace-nowrap">
              {selectedMods.size} {t.selectedCount || 'selected'}
            </span>

            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 shrink-0" />

            {/* Select / Deselect */}
            <button
              onClick={selectAll}
              className="px-3 py-1.5 text-xs font-bold rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 outline-none whitespace-nowrap"
            >
              {t.selectAll || 'Select All'}
            </button>
            <button
              onClick={deselectAll}
              className="px-3 py-1.5 text-xs font-bold rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 outline-none whitespace-nowrap"
            >
              {t.deselectAll || 'Deselect'}
            </button>

            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 shrink-0" />

            {/* Batch actions */}
            <button
              onClick={batchEnable}
              className="px-3 py-1.5 text-xs font-bold rounded-full text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-all duration-200 outline-none whitespace-nowrap"
            >
              {t.batchEnable || 'Enable All'}
            </button>
            <button
              onClick={batchDisable}
              className="px-3 py-1.5 text-xs font-bold rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 outline-none whitespace-nowrap"
            >
              {t.batchDisable || 'Disable All'}
            </button>
            <button
              onClick={batchDelete}
              className="px-3 py-1.5 text-xs font-bold rounded-full text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-all duration-200 outline-none whitespace-nowrap"
            >
              {t.batchDelete || 'Delete'}
            </button>

            {/* Close batch */}
            <button
              onClick={toggleBatchMode}
              className="ml-auto p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 outline-none"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ModulesTab;
