import React from 'react';
import { Package, Terminal } from 'lucide-react';
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
}) {
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
      )}
    </div>
  );
}

export default ModulesTab;
