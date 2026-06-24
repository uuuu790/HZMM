import { Hammer } from 'lucide-react';

/**
 * Steam Workshop tab.
 *
 * The sidebar entry, routing, and glider are wired; the actual Workshop
 * browser (item listing, subscribe / download) is not built yet. This
 * renders a polished placeholder so the tab is never blank.
 */
export default function SteamWorkshopTab({ t }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-28 lg:py-36 animate-slide-up">
      <div className="relative mb-7">
        <div className="absolute -inset-3 rounded-[2rem] bg-gradient-to-br from-sky-500/20 to-indigo-500/20 blur-2xl" />
        <div className="relative w-20 h-20 rounded-[1.75rem] bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl border border-white/40 dark:border-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.08)] flex items-center justify-center">
          <Hammer className="w-9 h-9 text-sky-500 dark:text-sky-400" />
        </div>
      </div>
      <h2 className="text-2xl font-black tracking-tight text-slate-800 dark:text-slate-100">{t.steamWorkshop}</h2>
      <p className="mt-2.5 max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-400">{t.steamWorkshopComingSoon}</p>
    </div>
  );
}
