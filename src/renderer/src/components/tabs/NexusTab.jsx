import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, RefreshCw, ExternalLink, DownloadCloud, Crown, Flame, Clock, Sparkles, TrendingUp, X } from 'lucide-react';
import NexusModCard from '../common/NexusModCard';
import NexusModDetailModal from '../modals/NexusModDetailModal';

// ============================================================
// Sort segments — map to V2 nexus:list-mods sort enum values.
// ============================================================
const SEGMENTS = [
  { id: 'trending', labelKey: 'nexusTrending', icon: Flame },
  { id: 'most_downloaded', labelKey: 'nexusMostDownloaded', icon: TrendingUp },
  { id: 'latest_updated', labelKey: 'nexusLatestUpdated', icon: Clock },
  { id: 'latest_added', labelKey: 'nexusLatestAdded', icon: Sparkles },
];

// ============================================================
// Gate states (API key / network / invalid — NOT Premium; Premium is now
// only a gate on the install button, browsing is always available).
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
// Main browse UI
// ============================================================
function BrowseUI({ t, lang, addToast, premiumName, isPremium }) {
  const [category, setCategory] = useState('trending');
  const [mods, setMods] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const searchTimerRef = useRef(null);

  const [selectedMod, setSelectedMod] = useState(null);
  const [installingModId, setInstallingModId] = useState(null);

  // Debounce the search input so typing doesn't spam the V2 endpoint.
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  // Load mods — either by sort (browse mode) or by keyword (search mode).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const loader = debouncedQuery
      ? window.api.nexus.searchMods(debouncedQuery)
      : window.api.nexus.listMods(category);

    loader.then(res => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.reason || 'unknown');
        setMods([]);
        setTotalCount(0);
      } else {
        setMods(res.mods || []);
        setTotalCount(res.totalCount || 0);
      }
      setLoading(false);
    }).catch(err => {
      if (cancelled) return;
      setError(err?.message || 'unknown');
      setMods([]);
      setTotalCount(0);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [category, debouncedQuery]);

  const handleQuickInstall = async (mod) => {
    if (installingModId) return;
    if (!isPremium) {
      addToast(t.nexusPremiumRequired, 'error');
      return;
    }
    setInstallingModId(mod.modId);
    try {
      await window.api.nexus.installMod(mod.modId);
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

  const inSearchMode = !!debouncedQuery;

  // Normalize mod shape — V2 uses camelCase, but NexusModCard was written
  // against V1's snake_case. Adapt the mod object on its way in.
  const adaptedMods = useMemo(() => mods.map(m => ({
    ...m,
    mod_id: m.modId,
    picture_url: m.pictureUrl || m.thumbnailUrl,
    mod_downloads: m.downloads,
    endorsement_count: m.endorsements,
    contains_adult_content: m.adultContent,
  })), [mods]);

  return (
    <div className="flex flex-col gap-4 animate-zoom-in duration-500">
      {/* Top bar: sort pills + search + external-search button */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className={`flex items-center gap-1 p-1 rounded-full bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/50 dark:border-slate-700/50 transition-opacity duration-200 ${inSearchMode ? 'opacity-40 pointer-events-none' : ''}`}>
          {SEGMENTS.map(seg => {
            const SegIcon = seg.icon;
            const active = category === seg.id;
            return (
              <button
                key={seg.id}
                onClick={() => setCategory(seg.id)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-full transition-all duration-300 active:scale-95 ${active ? 'text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                style={active ? { backgroundColor: 'var(--accent-500)', boxShadow: '0 4px 10px -2px rgba(var(--accent-rgb), 0.4)' } : undefined}
              >
                <SegIcon className="w-3.5 h-3.5" />
                <span className="hidden md:inline">{t[seg.labelKey]}</span>
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
            placeholder={t.nexusSearchPlaceholderV2}
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

      {/* Status strip — premium / count / search indicator */}
      <div className="flex items-center gap-4 text-[10px] font-bold tracking-widest uppercase text-slate-400 dark:text-slate-500">
        {isPremium && premiumName ? (
          <span className="flex items-center gap-1"><Crown className="w-3 h-3 text-amber-500" />Premium · {premiumName}</span>
        ) : (
          <span className="flex items-center gap-1 text-amber-500"><Crown className="w-3 h-3" />{t.nexusPremiumInstallOnly}</span>
        )}
        {!loading && !error && (
          <span>
            {inSearchMode
              ? t.nexusSearchResults?.replace('{n}', totalCount) || `${totalCount} results`
              : t.nexusCountTotal?.replace('{n}', totalCount) || `${totalCount} mods`}
          </span>
        )}
      </div>

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
      ) : adaptedMods.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400 dark:text-slate-500">
          <Search className="w-10 h-10 mb-3" />
          <p className="text-sm">{t.nexusNoResults}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
          {adaptedMods.map(mod => (
            <NexusModCard
              key={mod.modId}
              mod={mod}
              t={t}
              onClick={() => setSelectedMod(mod)}
              onQuickInstall={() => handleQuickInstall(mod)}
              installing={installingModId === mod.modId}
              installingAny={!!installingModId}
            />
          ))}
        </div>
      )}

      {selectedMod && (
        <NexusModDetailModal
          mod={selectedMod}
          t={t}
          lang={lang}
          onClose={() => setSelectedMod(null)}
          addToast={addToast}
          isPremium={isPremium}
        />
      )}
    </div>
  );
}

// ============================================================
// Root — runs V1 validate to detect Premium status, then hands off
// to BrowseUI. Only hard-gates rendering when there is NO API key
// (can't even check) or the key is invalid. Non-premium users still
// get to browse; install buttons just show a warning.
// ============================================================
export default function NexusTab({ t, lang, addToast, setActiveTab }) {
  const [state, setState] = useState({ loading: true });

  const runValidate = () => {
    setState({ loading: true });
    window.api.nexus.validate().then(res => {
      // V1 validate returns: ok (premium), or { ok:false, reason } for no-key/invalid/network.
      // Treat "not-premium" explicitly as "browsing OK, install gated".
      if (res.ok) {
        setState({ loading: false, ready: true, premium: true, name: res.name });
      } else if (res.reason === 'not-premium') {
        setState({ loading: false, ready: true, premium: false, name: res.name });
      } else {
        setState({ loading: false, ready: false, reason: res.reason, error: res.error });
      }
    }).catch(err => {
      setState({ loading: false, ready: false, reason: 'network', error: err?.message });
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

  // Hard gates — user literally can't use the tab without addressing these.
  if (!state.ready) {
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

  return <BrowseUI t={t} lang={lang} addToast={addToast} premiumName={state.name} isPremium={state.premium} />;
}
