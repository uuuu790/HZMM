import React, { useMemo, useCallback } from 'react';
import { Package, Terminal, Search, Layers, X, CheckSquare, Power, Trash2 } from 'lucide-react';
import ModuleList from '../common/ModuleList';

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
  searchQuery,
  setSearchQuery,
  filterType,
  setFilterType,
  sortBy,
  setSortBy,
  batchMode,
  setBatchMode,
  selectedMods,
  setSelectedMods,
  handleBatchToggle,
  handleBatchRemove,
  handleToggleSelect,
  isGameRunning,
}) {
  const processedModules = useMemo(() => {
    let result = [...modules]
    if (filterType !== 'all') result = result.filter(m => m.type === filterType)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(m => (m.title || m.filename).toLowerCase().includes(q))
    }
    switch (sortBy) {
      case 'name': result.sort((a, b) => (a.title || a.filename).localeCompare(b.title || b.filename)); break
      case 'nameDesc': result.sort((a, b) => (b.title || b.filename).localeCompare(a.title || a.filename)); break
      case 'type': result.sort((a, b) => a.type.localeCompare(b.type)); break
      case 'status': result.sort((a, b) => Number(b.enabled) - Number(a.enabled)); break
      case 'newest': result.sort((a, b) => new Date(b.modified) - new Date(a.modified)); break
    }
    return result
  }, [modules, filterType, searchQuery, sortBy])

  // Range select handler for Shift+Click
  const handleRangeSelect = useCallback((filenames) => {
    setSelectedMods(prev => {
      const next = new Set(prev)
      filenames.forEach(f => next.add(f))
      return next
    })
  }, [setSelectedMods])

  const hasSelection = selectedMods.size > 0

  return (
    <div className="flex flex-col gap-2 w-full animate-slide-up">
      {modules.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-slate-400 dark:text-slate-500 gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-full" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.1)', animation: 'emptyBreath 3s ease-in-out infinite' }} />
            <Package className="relative w-14 h-14 opacity-40" style={{ animation: 'emptyBreath 3s ease-in-out infinite' }} />
          </div>
          <h3 className="text-lg font-bold animate-slide-up" style={{ animationDelay: '100ms' }}>{t.noMods}</h3>
          <p className="text-sm animate-slide-up" style={{ animationDelay: '200ms' }}>{t.noModsDesc}</p>
        </div>
      ) : (
        <>
          {/* Search / Filter / Sort toolbar */}
          {modules.length > 0 && (
            <div className="flex flex-col gap-2 mb-2 px-2 animate-slide-up" style={{ animationFillMode: 'both', animationDelay: '0ms', animationDuration: '500ms' }}>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Search input */}
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t.search}
                    className="w-full pl-10 pr-4 py-2 text-xs font-medium rounded-full bg-white/50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 transition-all shadow-inner"
                    style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.3)' }}
                  />
                </div>

                {/* Type filter pills */}
                <div className="flex items-center bg-white/40 dark:bg-slate-900/40 rounded-full border border-slate-200/60 dark:border-slate-700/60 p-0.5">
                  {['all', 'PAK', 'UE4SS'].map(type => (
                    <button
                      key={type}
                      onClick={() => setFilterType(type)}
                      className={`px-3 py-1.5 text-[11px] font-bold rounded-full transition-all duration-300 ${filterType === type ? 'text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                      style={filterType === type ? { backgroundColor: 'var(--accent-500)' } : undefined}
                    >
                      {type === 'all' ? t.filterAll : type}
                    </button>
                  ))}
                </div>

                {/* Sort dropdown */}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="px-3 py-2 text-[11px] font-bold rounded-full bg-white/50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-700/80 text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-2 shadow-inner cursor-pointer appearance-none"
                  style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.3)', backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%239ca3af\' stroke-width=\'2\'%3E%3Cpath d=\'m6 9 6 6 6-6\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: '28px' }}
                >
                  <option value="name">{t.sortName}</option>
                  <option value="nameDesc">{t.sortNameDesc}</option>
                  <option value="type">{t.sortType}</option>
                  <option value="status">{t.sortStatus}</option>
                  <option value="newest">{t.sortNewest}</option>
                </select>
              </div>

              {/* Hint / Batch action bar */}
              {!hasSelection && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium px-2">
                  Ctrl+Click {t.selectAll?.toLowerCase() === '全選' ? '多選' : 'to select'} · Shift+Click {t.selectAll?.toLowerCase() === '全選' ? '範圍選取' : 'for range'}
                </p>
              )}
              {hasSelection && (
                <div className="flex items-center gap-1.5 flex-wrap animate-slide-up" style={{ animationDuration: '300ms' }}>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shadow-inner" style={{ backgroundColor: 'var(--accent-100)', color: 'var(--accent-600)' }}>
                    {selectedMods.size} {t.selectedCount}
                  </span>
                  <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
                  <button onClick={() => { const all = new Set(processedModules.map(m => m.filename)); setSelectedMods(all) }} className="px-2 py-1 text-[10px] font-bold rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 active:scale-95">{t.selectAll}</button>
                  <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
                  <button onClick={() => handleBatchToggle(true)} className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-full text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-all duration-200 active:scale-95"><Power className="w-2.5 h-2.5" />{t.batchEnable}</button>
                  <button onClick={() => handleBatchToggle(false)} className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 active:scale-95"><Power className="w-2.5 h-2.5" />{t.batchDisable}</button>
                  <button onClick={handleBatchRemove} className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-full text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-all duration-200 active:scale-95"><Trash2 className="w-2.5 h-2.5" />{t.batchDelete}</button>
                  <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
                  <button onClick={() => setSelectedMods(new Set())} className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 active:scale-95"><X className="w-3 h-3" /></button>
                </div>
              )}
            </div>
          )}

          {/* Empty search results */}
          {modules.length > 0 && processedModules.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-slate-500 animate-slide-up" style={{ animationDuration: '500ms' }}>
              <Search className="w-10 h-10 mb-3 opacity-40" style={{ animation: 'emptyBreath 3s ease-in-out infinite' }} />
              <p className="text-sm font-bold">{t.noMods}</p>
            </div>
          )}

          {/* Module lists */}
          {filterType === 'all' ? (
            <>
              <ModuleList
                modules={processedModules}
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
                selectedMods={selectedMods}
                onToggleSelect={handleToggleSelect}
                onRangeSelect={handleRangeSelect}
              />
              <ModuleList
                modules={processedModules}
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
                selectedMods={selectedMods}
                onToggleSelect={handleToggleSelect}
                onRangeSelect={handleRangeSelect}
              />
            </>
          ) : (
            <ModuleList
              modules={processedModules}
              type={filterType}
              title={filterType === 'PAK' ? t.pakTitle : t.ue4ssTitle}
              icon={filterType === 'PAK' ? Package : Terminal}
              colorClass={filterType === 'PAK' ? 'text-indigo-600 dark:text-indigo-400' : 'text-rose-600 dark:text-rose-400'}
              activeModuleId={activeModuleId}
              onModuleClick={handleModuleClick}
              onToggle={handleToggleEnable}
              onUninstallLocal={handleUninstallLocalMod}
              onOpenConfig={setConfigEditorMod}
              t={t}
              lang={lang}
              newlyInstalledMods={newlyInstalledMods}
              selectedMods={selectedMods}
              onToggleSelect={handleToggleSelect}
              onRangeSelect={handleRangeSelect}
            />
          )}

        </>
      )}
    </div>
  );
}

export default ModulesTab;
