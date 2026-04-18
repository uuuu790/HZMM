import { useRef, useEffect } from 'react';
import { Globe, ChevronDown, ExternalLink } from 'lucide-react';

export default function AppHeader({
  activeTab, t, isDark, lang, supportedLocales,
  langDropdownOpen, setLangDropdownOpen, changeLang,
}) {
  const langDropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (langDropdownRef.current && !langDropdownRef.current.contains(e.target)) {
        setLangDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setLangDropdownOpen]);

  // Keep the header's max width in sync with the main content below it so the
  // right edge (Nexus Mods + language picker) lines up with the rightmost card.
  // Nexus tab is wider (1600px) than the other tabs (max-w-6xl = 1152px), so
  // we animate the max-width for a slide-out/slide-in feel when switching tabs.
  const isWide = activeTab === 'nexus';

  const tabTitle =
    activeTab === 'modules' ? t.modules :
    activeTab === 'dashboard' ? t.dashboard :
    activeTab === 'profiles' ? t.profiles :
    activeTab === 'nexus' ? (t.nexus || 'Nexus') :
    t.settings;

  return (
    <header
      className={`w-full flex justify-between items-center mb-8 z-30 relative animate-slide-down duration-700 select-none [-webkit-app-region:drag] ${isWide ? 'max-w-[1600px]' : 'max-w-6xl'}`}
      // Matches <main>'s springy width transition so the top bar slides out in
      // sync with the content below when switching to/from the Nexus tab.
      style={{ transition: 'max-width 500ms cubic-bezier(0.34, 1.56, 0.64, 1)' }}
    >
      <h2 className="text-2xl font-light text-slate-600 dark:text-slate-400 tracking-wide flex items-center gap-3 transition-colors duration-700">
        <span className="text-slate-400 dark:text-slate-500 font-bold">HZMM</span>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <span className="font-bold text-slate-800 dark:text-slate-200">
          {tabTitle}
        </span>
      </h2>

      <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
        <button
          onClick={() => window.api?.system?.openExternal('https://www.nexusmods.com/humanitz/mods')}
          className="flex items-center gap-2 bg-white/60 dark:bg-slate-800/60 backdrop-blur-md px-4 py-2 rounded-full border border-slate-200 dark:border-slate-700 shadow-sm hover:bg-[var(--accent-50)] dark:hover:bg-[rgba(var(--accent-rgb),0.2)] hover:border-[var(--accent-300)] dark:hover:border-[var(--accent-700)] transition-all hover:scale-105 hover:shadow-md active:scale-95 text-slate-600 dark:text-slate-300 font-bold text-sm cursor-pointer duration-300"
        >
          <ExternalLink className="w-4 h-4" style={{ color: 'var(--accent-500)' }} />
          <span className="hidden sm:inline">Nexus Mods</span>
        </button>
        <div className="relative" ref={langDropdownRef}>
          <button
            onClick={() => setLangDropdownOpen(prev => !prev)}
            className="group relative flex items-center gap-2 px-4 py-2 rounded-full text-slate-600 dark:text-slate-300 font-bold text-sm cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-md active:scale-95"
          >
            <div className="absolute inset-0 rounded-full bg-white/60 dark:bg-slate-800/60 backdrop-blur-md border border-slate-200 dark:border-slate-700 shadow-sm group-hover:bg-[var(--accent-50)] group-hover:dark:bg-[rgba(var(--accent-rgb),0.2)] group-hover:border-[var(--accent-300)] group-hover:dark:border-[var(--accent-700)] transition-colors duration-300" />
            <Globe className="relative w-4 h-4 animate-[spin_10s_linear_infinite]" style={{ color: 'var(--accent-500)' }} />
            <span className="relative hidden sm:inline">{supportedLocales.find(l => l.code === lang)?.name || lang}</span>
            <ChevronDown className={`relative w-3 h-3 transition-transform duration-300 ${langDropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          {langDropdownOpen && (
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 min-w-[140px] py-1.5 bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl shadow-[0_12px_48px_-4px_rgba(0,0,0,0.12),0_4px_16px_-2px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_48px_-4px_rgba(0,0,0,0.6),0_4px_16px_-2px_rgba(0,0,0,0.3)] z-50 animate-zoom-in">
              {supportedLocales.map((locale, i) => (
                <button
                  key={locale.code}
                  onClick={() => changeLang(locale.code)}
                  style={{ animationDelay: `${i * 40}ms`, ...(locale.code === lang ? { color: isDark ? 'var(--accent-400)' : 'var(--accent-600)' } : {}) }}
                  className={`w-full text-left px-4 py-2 text-sm cursor-pointer flex items-center gap-3 opacity-0 animate-[langItemIn_0.3s_ease_forwards] transition-colors duration-150
                    ${locale.code === lang
                      ? 'font-bold'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}
                >
                  {locale.code === lang && (
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: 'var(--accent-500)' }} />
                  )}
                  <span className={locale.code === lang ? '' : 'ml-[18px]'}>{locale.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
