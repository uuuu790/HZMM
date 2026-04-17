import { useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, ExternalLink, DownloadCloud, Crown, Flame, Clock, Sparkles, X } from 'lucide-react';
import NexusModCard from '../common/NexusModCard';
import NexusModDetailModal from '../modals/NexusModDetailModal';

// Map between segment id and i18n key + Nexus category id.
const SEGMENTS = [
  { id: 'trending', labelKey: 'nexusTrending', icon: Flame },
  { id: 'latest_updated', labelKey: 'nexusLatestUpdated', icon: Clock },
  { id: 'latest_added', labelKey: 'nexusLatestAdded', icon: Sparkles },
];

// ============================================================
// Gate states — shown when validate() rejects browsing access.
// ============================================================
function GateCard({ icon: Icon, title, description, cta, onCta, iconColor }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-8 max-w-xl mx-auto">
      <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-6 ${iconColor || 'bg-slate-100 dark:bg-slate-800'} shadow-[0_8px_24px_rgba(0,0,0,0.05)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.3)]`}>
        <Icon className="w-10 h-10 text-white" />
      </div>
      <h2 className="text-xl font-black tracking-wide text-slate-800 dark:text-slate-100 mb-2">{title}</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6">{description}</p>
      {cta && (
        <button onClick={onCta} className="flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-sm font-bold transition-all duration-300 active:scale-95 hover:-translate-y-0.5" style={{ backgroundColor: 'var(--accent-500)', boxShadow: '0 8px 20px rgba(var(--accent-rgb), 0.3)' }}>
          {cta}
        </button>
      )}
    </div>
  );
}

// ============================================================
// Main browse UI — segment + search + grid.
// ============================================================
function BrowseUI({ t, lang, addToast, premiumName }) {
  const [category, setCategory] = useState('trending');
  const [mods, setMods] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMod, setSelectedMod] = useState(null);
  const [installingModId, setInstallingModId] = useState(null);

  // Load the selected segment. Main-process cache handles rate-limit politeness,
  // so we can re-fetch freely on tab switch — cache hit returns in <1ms.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    window.api.nexus.listMods(category).then(res => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.reason || 'unknown');
        setMods([]);
      } else {
        setMods(res.mods);
      }
      setLoading(false);
    }).catch(err => {
      if (cancelled) return;
      setError(err?.message || 'unknown');
      setMods([]);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [category]);

  // Client-side filter across the loaded list (Nexus v1 API has no
  // keyword-search endpoint — see CONFIG_SCHEMA.md notes on browse limits).
  const filteredMods = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return mods;
    return mods.filter(m =>
      (m.name || '').toLowerCase().includes(q) ||
      (m.author || '').toLowerCase().includes(q) ||
      (m.uploaded_by || '').toLowerCase().includes(q) ||
      (m.summary || '').toLowerCase().includes(q)
    );
  }, [mods, searchQuery]);

  const handleQuickInstall = async (mod) => {
    if (installingModId) return;
    setInstallingModId(mod.mod_id);
    try {
      await window.api.nexus.installMod(mod.mod_id);
      addToast(`${t.nexusInstalledToast}: ${mod.name}`, 'success');
    } catch (err) {
      addToast(`${t.nexusInstallFailedToast}: ${err?.message || err}`, 'error');
    } finally {
      setInstallingModId(null);
    }
  };

  const openNexusSearch = () => {
    const url = searchQuery.trim()
      ? `https://www.nexusmods.com/humanitz/mods/?BH=0&keyword=${encodeURIComponent(searchQuery)}`
      : 'https://www.nexusmods.com/humanitz';
    window.api?.system?.openExternal?.(url);
  };

  return (
    <div className="flex flex-col gap-4 animate-zoom-in duration-500">
      {/* Header — segment control + search + external link */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 p-1 rounded-full bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/50 dark:border-slate-700/50">
          {SEGMENTS.map(seg => {
            const SegIcon = seg.icon;
            const active = category === seg.id;
            return (
              <button
                key={seg.id}
                onClick={() => setCategory(seg.id)}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-full transition-all duration-300 active:scale-95 ${active ? 'text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                style={active ? { backgroundColor: 'var(--accent-500)', boxShadow: '0 4px 10px -2px rgba(var(--accent-rgb), 0.4)' } : undefined}
              >
                <SegIcon className="w-3.5 h-3.5" />
                {t[seg.labelKey]}
              </button>
            );
          })}
        </div>

        <div className="flex-1 min-w-[240px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t.nexusSearchPlaceholder}
            className="w-full pl-10 pr-10 py-2 text-sm rounded-full bg-white/80 dark:bg-slate-900/80 border border-slate-200/50 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-offset-0 transition-all"
            style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.3)' }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600 flex items-center justify-center transition-colors"
              title="Clear"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <button
          onClick={openNexusSearch}
          title={t.nexusSearchOnWeb}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-full bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/50 dark:border-slate-700/50 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 active:scale-95 transition-all"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span className="hidden md:block">{t.nexusSearchOnWeb}</span>
        </button>
      </div>

      {/* Premium badge */}
      {premiumName && (
        <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase text-slate-400 dark:text-slate-500">
          <Crown className="w-3 h-3 text-amber-500" />
          <span>Premium · {premiumName}</span>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-slate-400 dark:text-slate-500">
          <RefreshCw className="w-6 h-6 animate-spin mr-3" />
          <span className="text-sm">{t.nexusLoading}</span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-24 text-center px-8">
          <DownloadCloud className="w-10 h-10 text-slate-400 mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">{t.nexusNetworkError}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 font-mono">{error}</p>
        </div>
      ) : filteredMods.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400 dark:text-slate-500">
          <Search className="w-10 h-10 mb-3" />
          <p className="text-sm">{t.nexusNoResults}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
          {filteredMods.map(mod => (
            <NexusModCard
              key={mod.mod_id}
              mod={mod}
              t={t}
              onClick={() => setSelectedMod(mod)}
              onQuickInstall={() => handleQuickInstall(mod)}
              installing={installingModId === mod.mod_id}
              installingAny={!!installingModId}
            />
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selectedMod && (
        <NexusModDetailModal
          mod={selectedMod}
          t={t}
          lang={lang}
          onClose={() => setSelectedMod(null)}
          addToast={addToast}
        />
      )}
    </div>
  );
}

// ============================================================
// Root — validate first, then decide what to render.
// ============================================================
export default function NexusTab({ t, lang, addToast, setActiveTab }) {
  const [state, setState] = useState({ loading: true });

  const runValidate = () => {
    setState({ loading: true });
    window.api.nexus.validate().then(res => {
      if (res.ok) {
        setState({ loading: false, ok: true, premium: true, name: res.name });
      } else {
        setState({ loading: false, ok: false, reason: res.reason, error: res.error });
      }
    }).catch(err => {
      setState({ loading: false, ok: false, reason: 'network', error: err?.message });
    });
  };

  useEffect(() => { runValidate(); }, []);

  if (state.loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw className="w-6 h-6 animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    );
  }

  if (state.ok) {
    return <BrowseUI t={t} lang={lang} addToast={addToast} premiumName={state.name} />;
  }

  // Gate states
  if (state.reason === 'no-key') {
    return (
      <GateCard
        icon={DownloadCloud}
        iconColor="bg-gradient-to-br from-slate-400 to-slate-600"
        title={t.nexusNoApiKey}
        description={t.nexusNoApiKeyDesc}
        cta={t.nexusGoToSettings}
        onCta={() => setActiveTab('settings')}
      />
    );
  }

  if (state.reason === 'invalid') {
    return (
      <GateCard
        icon={DownloadCloud}
        iconColor="bg-gradient-to-br from-red-500 to-rose-600"
        title={t.nexusApiKeyInvalid}
        description={t.nexusApiKeyInvalidDesc}
        cta={t.nexusGoToSettings}
        onCta={() => setActiveTab('settings')}
      />
    );
  }

  if (state.reason === 'not-premium') {
    return (
      <GateCard
        icon={Crown}
        iconColor="bg-gradient-to-br from-amber-400 to-orange-500"
        title={t.nexusPremiumRequired}
        description={t.nexusPremiumRequiredDesc}
      />
    );
  }

  // network or unknown
  return (
    <GateCard
      icon={DownloadCloud}
      iconColor="bg-gradient-to-br from-slate-500 to-slate-700"
      title={t.nexusNetworkError}
      description={state.error || ''}
      cta={<><RefreshCw className="w-4 h-4" /> Retry</>}
      onCta={runValidate}
    />
  );
}

