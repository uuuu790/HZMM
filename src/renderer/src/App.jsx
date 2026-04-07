import React, { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { CheckCircle, Settings, Play, Globe, Sun, Moon, ChevronDown, LayoutDashboard, Layers, Save, ExternalLink } from 'lucide-react';
import appIcon from './assets/icon.png';

// Constants
import { UI_TEXT } from './constants/i18n';
import { THEME_PRESETS, getTheme } from './constants/themes';

// Styles
import { APP_STYLES } from './styles/appStyles';

// Common components
import { ToastContainer, ConfirmModal } from './components/common';

// Modal components
import ConfigEditorModal from './components/modals/ConfigEditorModal';
import ConflictModal from './components/modals/ConflictModal';
import LogModal from './components/modals/LogModal';
import PreviewModal from './components/modals/PreviewModal';
import WorldSelectModal from './components/modals/WorldSelectModal';

// Tab components
import DashboardTab from './components/tabs/DashboardTab';
const ModulesTab = lazy(() => import('./components/tabs/ModulesTab'));
const ProfilesTab = lazy(() => import('./components/tabs/ProfilesTab'));
const SettingsTab = lazy(() => import('./components/tabs/SettingsTab'));

// Hooks
import { useModHandlers } from './hooks/useModHandlers';
import { useBackupHandlers } from './hooks/useBackupHandlers';
import { useProfileHandlers } from './hooks/useProfileHandlers';
import { useUpdateHandlers } from './hooks/useUpdateHandlers';
import { useAppInit } from './hooks/useAppInit';

// ==========================================
// Main App Component
// ==========================================

export default function App() {
  // --- Language ---
  const [lang, setLang] = useState('zh-TW');
  const [supportedLocales, setSupportedLocales] = useState([]);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const langDropdownRef = useRef(null);

  // --- Theme ---
  const [isDark, setIsDark] = useState(false);
  const [themeId, setThemeId] = useState('ember');

  // --- Tray & Startup ---
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [autoStart, setAutoStart] = useState(false);

  // --- i18n ---
  const t = UI_TEXT[lang];

  // --- Tab ---
  const [activeTab, setActiveTab] = useState('dashboard');
  const prevTabRef = useRef('dashboard');
  const tabOrder = ['dashboard', 'modules', 'profiles', 'settings'];

  // --- Sidebar ---
  const navRef = useRef(null);
  const [indicatorTop, setIndicatorTop] = useState(0);

  // --- Toast ---
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);

  // --- Config Editor ---
  const [configEditorMod, setConfigEditorMod] = useState(null);

  // --- Confirm Modal ---
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', description: '', onConfirm: null, variant: 'danger' });

  // ==========================================
  // Shared Helpers
  // ==========================================

  const addToast = useCallback((message, type = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showConfirm = useCallback((title, description, onConfirm, variant = 'danger') => {
    setConfirmModal({ isOpen: true, title, description, onConfirm, variant });
  }, []);

  const closeConfirm = useCallback(() => {
    setConfirmModal({ isOpen: false, title: '', description: '', onConfirm: null, variant: 'danger' });
  }, []);

  const persistSetting = useCallback((key, value) => {
    if (window.api) window.api.settings.set(key, value);
  }, []);

  const handleSetMinimizeToTray = useCallback((enabled) => {
    setMinimizeToTray(enabled);
    if (window.api) window.api.settings.set('minimizeToTray', enabled);
  }, []);

  const handleSetAutoStart = useCallback((enabled) => {
    setAutoStart(enabled);
    if (window.api) window.api.system.setAutoStart(enabled);
  }, []);

  // ==========================================
  // Hooks
  // ==========================================

  // -- Update handlers (no deps on other hooks) --
  const {
    appVersion, updateState, updateInfo, updateProgress, isUpdating,
    handleCheckUpdate, handleDownloadUpdate, handleInstallUpdate,
    initVersion,
  } = useUpdateHandlers({ addToast, t });

  // -- Mod handlers (needs isGameRunning from appInit, but we solve the circular dep below) --
  const [isGameRunningProxy, setIsGameRunningProxy] = useState(false);

  const modHandlers = useModHandlers({
    addToast, showConfirm, t,
    isGameRunning: isGameRunningProxy,
    persistSetting,
  });

  const {
    modules, newlyInstalledMods,
    activeModuleId, setActiveModuleId,
    searchQuery, setSearchQuery,
    filterType, setFilterType,
    sortBy, setSortBy,
    batchMode, setBatchMode,
    selectedMods, setSelectedMods,
    urlInput, setUrlInput,
    urlDownloading, urlProgress, setUrlProgress,
    showPreview, setShowPreview,
    previewData, setPreviewData,
    previewLoading,
    pendingInstallPaths, setPendingInstallPaths,
    nexusApiKey,
    isDragging, setIsDragging,
    fileInputRef,
    refreshMods,
    handleModuleClick,
    handleToggleEnable,
    handleUninstallLocalMod,
    handleInstallWithPreview,
    handleConfirmInstall,
    handleDrop,
    handleImportFiles,
    handleUrlInstall,
    handleSetNexusApiKey,
    handleBatchToggle,
    handleBatchRemove,
    handleToggleSelect,
    initMods,
  } = modHandlers;

  // -- App init (game, UE4SS, conflict, log, rescan) --
  const {
    gamePath, gameVersion,
    isGameRunning, detecting,
    ue4ssStatus, ue4ssProgress, ue4ssVersion,
    isProcessing,
    conflictModalOpen, setConflictModalOpen,
    conflicts, conflictScanning,
    logModalOpen, setLogModalOpen,
    logLines, logLoading,
    rescanning,
    handleDetectPath, handleBrowsePath, handleLaunch,
    handleUe4ssAction,
    handleConflictScan, handleOpenLogs, handleOpenLogFile,
    handleRescan,
    initGame,
  } = useAppInit({ addToast, t, refreshMods });

  // Sync isGameRunning to the proxy so mod handlers can use it
  useEffect(() => {
    setIsGameRunningProxy(isGameRunning);
  }, [isGameRunning]);

  // -- Backup handlers --
  const {
    backups, backupLoading,
    worldSelectOpen, setWorldSelectOpen,
    worldSelectLoading, availableWorlds,
    handleBackup, handleConfirmBackup, handleListBackups,
    handleRestoreBackup, handleDeleteBackup,
    initBackups,
  } = useBackupHandlers({ addToast, showConfirm, t });

  // -- Profile handlers --
  const {
    profiles, activeProfileId,
    newProfileName, setNewProfileName,
    applyingProfileId,
    handleCreateProfile, handleApplyProfile, handleDeleteProfile,
    handleExportProfile, handleImportProfile,
    initProfiles,
  } = useProfileHandlers({ addToast, showConfirm, closeConfirm, t, modules, persistSetting, refreshMods });

  // ==========================================
  // Track tab changes for direction-aware animation
  // ==========================================

  useEffect(() => {
    prevTabRef.current = activeTab;
  }, [activeTab]);

  // ==========================================
  // Initialization
  // ==========================================

  useEffect(() => {
    async function init() {
      if (!window.api) return;

      // Run UI settings and module init concurrently — no cross-dependencies
      await Promise.all([
        // UI settings
        window.api.locale.getPreference().then(v => setLang(v)),
        window.api.locale.getSupported().then(v => setSupportedLocales(v)),
        window.api.settings.get('darkMode', false).then(v => setIsDark(v)),
        window.api.settings.get('themeId', 'ember').then(v => setThemeId(v)),
        window.api.settings.get('minimizeToTray', true).then(v => setMinimizeToTray(v)),
        window.api.system.getAutoStart().then(v => setAutoStart(v)).catch(() => {}),
        // Module init
        initProfiles(),
        initGame(),
        initVersion(),
        initBackups(),
        initMods(),
      ]);
    }
    init();
  }, []);

  // Listen for mod updates
  useEffect(() => {
    if (!window.api) return;
    const unsub = window.api.mods.onUpdated(async () => { await refreshMods(true); });
    return unsub;
  }, [refreshMods]);

  // Listen for URL download progress
  useEffect(() => {
    if (!window.api) return;
    const unsubProgress = window.api.mods.onDownloadProgress?.((progress) => {
      setUrlProgress(progress);
    });
    return () => { if (unsubProgress) unsubProgress(); };
  }, [setUrlProgress]);

  // Global drag-and-drop: prevent default to allow drops
  useEffect(() => {
    const preventDrag = (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    window.addEventListener('dragover', preventDrag);
    window.addEventListener('drop', preventDrag);
    return () => {
      window.removeEventListener('dragover', preventDrag);
      window.removeEventListener('drop', preventDrag);
    };
  }, []);

  // Close language dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (langDropdownRef.current && !langDropdownRef.current.contains(e.target)) {
        setLangDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sidebar sliding indicator
  useEffect(() => {
    if (!navRef.current) return;
    const btn = navRef.current.querySelector(`[data-tab="${activeTab}"]`);
    if (!btn) return;
    const navRect = navRef.current.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    setIndicatorTop(btnRect.top - navRect.top + (btnRect.height - 24) / 2);
  }, [activeTab]);

  // ==========================================
  // Theme Management
  // ==========================================

  const toggleDark = () => {
    setIsDark(prev => {
      const next = !prev;
      persistSetting('darkMode', next);
      return next;
    });
  };

  const activeTransitionRef = useRef(null);

  const changeTheme = useCallback((id, e) => {
    if (id === themeId) return;
    if (activeTransitionRef.current) {
      activeTransitionRef.current.skipTransition();
      activeTransitionRef.current = null;
    }
    if (e && document.startViewTransition) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const maxDist = Math.max(
        Math.hypot(x, y),
        Math.hypot(window.innerWidth - x, y),
        Math.hypot(x, window.innerHeight - y),
        Math.hypot(window.innerWidth - x, window.innerHeight - y)
      );
      const duration = 1000;
      const easing = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

      const transition = document.startViewTransition(() => {
        flushSync(() => { setThemeId(id); });
        persistSetting('themeId', id);
      });
      activeTransitionRef.current = transition;
      transition.finished.then(() => { activeTransitionRef.current = null; });
      transition.ready.then(() => {
        document.documentElement.animate([
          { clipPath: `circle(0px at ${x}px ${y}px)` },
          { clipPath: `circle(${maxDist}px at ${x}px ${y}px)` },
        ], { duration, easing, pseudoElement: '::view-transition-new(root)' });
        document.documentElement.animate([
          { filter: 'brightness(1)', opacity: 1 },
          { filter: 'brightness(0.96)', opacity: 0.98 },
        ], { duration, easing, pseudoElement: '::view-transition-old(root)' });
      });
    } else {
      setThemeId(id);
      persistSetting('themeId', id);
    }
  }, [themeId, persistSetting]);

  // Apply theme CSS variables
  useEffect(() => {
    const theme = getTheme(themeId);
    const root = document.documentElement;
    Object.entries(theme.accent).forEach(([key, val]) => {
      root.style.setProperty(`--accent-${key}`, val);
    });
    root.style.setProperty('--gradient-from', theme.gradient.from);
    root.style.setProperty('--gradient-to', theme.gradient.to);
    root.style.setProperty('--icon-hue-rotate', theme.iconHueRotate || '0deg');
    theme.orbs.light.forEach((c, i) => root.style.setProperty(`--orb-light-${i + 1}`, c));
    theme.orbs.dark.forEach((c, i) => root.style.setProperty(`--orb-dark-${i + 1}`, c));
  }, [themeId]);

  const changeLang = useCallback((code) => {
    setLang(code);
    setLangDropdownOpen(false);
    if (window.api) window.api.locale.setPreference(code);
  }, []);

  // ==========================================
  // Render
  // ==========================================

  return (
    <div className={`min-h-screen font-sans overflow-hidden flex relative transition-colors duration-700 ease-in-out ${isDark ? 'dark text-slate-200' : 'text-slate-800'}`}>

      <style>{APP_STYLES}</style>

      {/* Background */}
      <div className={`fixed inset-0 pointer-events-none transition-colors duration-1000 -z-20 ${isDark ? 'bg-slate-950' : 'bg-slate-50'}`} />

      {/* Floating orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className={`absolute top-[-12%] left-[-12%] w-[38vw] h-[38vw] md:w-[32vw] md:h-[32vw] 2xl:w-[38vw] 2xl:h-[38vw] rounded-full blur-[100px] md:blur-[160px] 2xl:blur-[220px] transition-all duration-1000 ease-in-out orb-float-1 ${isDark ? 'mix-blend-screen' : 'mix-blend-normal'}`} style={{ backgroundColor: isDark ? 'var(--orb-dark-1)' : 'var(--orb-light-1)' }} />
        <div className={`absolute top-[-8%] right-[-8%] w-[32vw] h-[32vw] md:w-[26vw] md:h-[26vw] 2xl:w-[32vw] 2xl:h-[32vw] rounded-full blur-[100px] md:blur-[160px] 2xl:blur-[220px] transition-all duration-1000 ease-in-out orb-float-2 ${isDark ? 'mix-blend-screen' : 'mix-blend-normal'}`} style={{ backgroundColor: isDark ? 'var(--orb-dark-2)' : 'var(--orb-light-2)' }} />
        <div className={`absolute bottom-[-12%] left-[-12%] w-[42vw] h-[42vw] md:w-[35vw] md:h-[35vw] 2xl:w-[42vw] 2xl:h-[42vw] rounded-full blur-[110px] md:blur-[180px] 2xl:blur-[250px] transition-all duration-1000 ease-in-out orb-float-3 ${isDark ? 'mix-blend-screen' : 'mix-blend-normal'}`} style={{ backgroundColor: isDark ? 'var(--orb-dark-3)' : 'var(--orb-light-3)' }} />
        <div className={`absolute bottom-[-16%] right-[-8%] w-[34vw] h-[34vw] md:w-[28vw] md:h-[28vw] 2xl:w-[35vw] 2xl:h-[35vw] rounded-full blur-[100px] md:blur-[160px] 2xl:blur-[220px] transition-all duration-1000 ease-in-out orb-float-4 ${isDark ? 'mix-blend-screen' : 'mix-blend-normal'}`} style={{ backgroundColor: isDark ? 'var(--orb-dark-4)' : 'var(--orb-light-4)' }} />
      </div>

      {/* Fixed drag bar for Electron title bar */}
      <div className="fixed top-0 left-0 right-0 h-[36px] z-[999] [-webkit-app-region:drag] pointer-events-none" />

      {/* ============ Sidebar ============ */}
      <aside className="w-20 lg:w-64 border-r border-slate-200/50 dark:border-white/5 bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl flex flex-col z-20 transition-colors duration-700 shadow-[4px_0_24px_rgba(0,0,0,0.02)] dark:shadow-[4px_0_24px_rgba(0,0,0,0.2)]">
        <div className="h-24 flex items-center justify-center lg:justify-start lg:px-8 border-b border-slate-200/50 dark:border-white/5 transition-colors duration-700 [-webkit-app-region:drag]">
          <div className="w-10 h-10 shrink-0 rounded-full logo-breath transition-[filter] duration-700" style={{ backgroundImage: `url(${appIcon})`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', filter: 'hue-rotate(var(--icon-hue-rotate))' }} />
          <h1 className="hidden lg:block ml-4 text-2xl font-black tracking-widest text-transparent bg-clip-text transition-all duration-700" style={{ backgroundImage: `linear-gradient(to right, var(--gradient-from), var(--gradient-to))` }}>
            HZMM
          </h1>
        </div>

        <nav ref={navRef} className="flex-1 py-8 flex flex-col gap-3 px-4 [-webkit-app-region:no-drag] relative">
          <div
            className="absolute left-6 w-1.5 h-6 rounded-full z-10 pointer-events-none"
            style={{ top: indicatorTop, transition: 'top 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)', backgroundColor: 'var(--accent-500)', boxShadow: '0 0 12px rgba(var(--accent-rgb), 0.5)' }}
          />
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: t.dashboard },
            { id: 'modules', icon: Layers, label: t.modules },
            { id: 'profiles', icon: Save, label: t.profiles },
            { id: 'settings', icon: Settings, label: t.settings },
          ].map((item) => (
            <button
              key={item.id}
              data-tab={item.id}
              onClick={() => { setActiveTab(item.id); setActiveModuleId(null); }}
              className={`flex items-center gap-4 px-4 py-3.5 rounded-full transition-all duration-300 group relative overflow-hidden outline-none focus:outline-none active:outline-none [-webkit-tap-highlight-color:transparent] ${
                activeTab === item.id ? 'border' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-white/60 dark:hover:bg-white/5 border border-transparent hover:shadow-sm'
              }`}
              style={activeTab === item.id ? { backgroundColor: 'rgba(var(--accent-rgb), 0.1)', color: isDark ? 'var(--accent-400)' : 'var(--accent-600)', borderColor: 'rgba(var(--accent-rgb), 0.2)', boxShadow: '0 0 15px rgba(var(--accent-rgb), 0.1)' } : undefined}
            >
              <item.icon className={`w-5 h-5 shrink-0 transition-transform duration-300 ${activeTab === item.id ? 'scale-110' : 'group-hover:scale-110'}`} />
              <span className="hidden lg:block font-medium tracking-wide">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Launch Game button */}
        <div className="px-4 pb-6 [-webkit-app-region:no-drag]">
          <div className="relative w-full group">
            <div className={`absolute -inset-1.5 blur-lg opacity-40 group-hover:opacity-75 animate-pulse transition-all duration-500 rounded-2xl lg:rounded-full pointer-events-none ${isGameRunning ? 'bg-gradient-to-r from-emerald-500 to-green-500' : ''}`} style={!isGameRunning ? { background: `linear-gradient(to right, var(--gradient-from), var(--gradient-to))` } : undefined} />
            <button onClick={handleLaunch} disabled={isGameRunning} className={`launch-hover relative w-full flex items-center justify-center lg:justify-start gap-3 text-white p-3 lg:px-5 lg:py-3.5 rounded-2xl lg:rounded-full transition-all duration-500 overflow-hidden z-10 ${isGameRunning
              ? 'bg-gradient-to-r from-emerald-500 to-green-600 shadow-[0_8px_20px_rgba(16,185,129,0.3)] cursor-default'
              : 'hover:-translate-y-0.5 active:scale-95'}`}
              style={!isGameRunning ? { background: 'linear-gradient(to right, var(--gradient-from), var(--gradient-to))', boxShadow: '0 8px 20px rgba(var(--accent-rgb), 0.3)' } : undefined}>
              <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="launch-glow absolute inset-0 rounded-[inherit] pointer-events-none" style={{ opacity: 0, backgroundColor: 'rgba(var(--accent-rgb), 0.3)' }} />
              {isGameRunning
                ? <CheckCircle className="w-5 h-5 shrink-0 relative z-10" />
                : <Play className="launch-icon w-5 h-5 fill-white shrink-0 relative z-10" />
              }
              <div className="hidden lg:flex flex-1 items-center justify-between min-w-0 relative z-10">
                <span className="font-black tracking-widest text-sm whitespace-nowrap">{isGameRunning ? t.gameRunning : t.launch}</span>
                <span className="font-mono text-[10px] font-bold bg-white/20 text-white/90 px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 transition-colors duration-300 group-hover:bg-white/30 group-hover:text-white shadow-inner">
                  {gameVersion?.versionName ? `v${gameVersion.versionName}` : gameVersion?.buildId ? `#${gameVersion.buildId}` : gameVersion?.fileVersion ? `v${gameVersion.fileVersion}` : 'v1.0'}
                </span>
              </div>
            </button>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200/50 dark:border-white/5 flex items-center justify-center lg:justify-start gap-2 text-slate-400 dark:text-slate-500 transition-colors duration-700">
          <Settings className="w-4 h-4 rounded-full shrink-0" />
          <span className="hidden lg:block text-[10px] font-mono font-bold tracking-wider truncate">HZMM Manager v{appVersion || '1.0.0'}</span>
        </div>
      </aside>

      {/* ============ Main Content ============ */}
      <div className="flex-1 flex flex-col h-screen overflow-y-auto relative z-10 p-4 pt-16 md:p-8 md:pt-16 md:pl-12 items-center [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400/80 dark:hover:[&::-webkit-scrollbar-thumb]:bg-slate-600/80 transition-colors scroll-smooth">

        <div className="absolute top-0 left-0 w-full h-12 [-webkit-app-region:drag]" />

        {/* Header */}
        <header className="w-full max-w-6xl flex justify-between items-center mb-8 z-30 relative animate-slide-down duration-700 select-none [-webkit-app-region:drag]">
          <h2 className="text-2xl font-light text-slate-600 dark:text-slate-400 tracking-wide flex items-center gap-3 transition-colors duration-700">
            <span className="text-slate-400 dark:text-slate-500 font-bold">HZMM</span>
            <span className="text-slate-300 dark:text-slate-600">/</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">
              {activeTab === 'modules' ? t.modules : activeTab === 'dashboard' ? t.dashboard : activeTab === 'profiles' ? t.profiles : t.settings}
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

        <main className="w-full max-w-6xl flex-1 relative z-10 pb-12">
          <div key={activeTab} className={tabOrder.indexOf(activeTab) >= tabOrder.indexOf(prevTabRef.current) ? 'animate-tab-left' : 'animate-tab-right'}>

          {activeTab === 'dashboard' && (
            <DashboardTab
              t={t} modules={modules} isDark={isDark}
              isDragging={isDragging} setIsDragging={setIsDragging}
              fileInputRef={fileInputRef} handleDrop={handleDrop}
              handleImportFiles={handleImportFiles} addToast={addToast}
              ue4ssStatus={ue4ssStatus} ue4ssProgress={ue4ssProgress}
              ue4ssVersion={ue4ssVersion} isProcessing={isProcessing}
              handleUe4ssAction={handleUe4ssAction}
              urlInput={urlInput} setUrlInput={setUrlInput}
              urlDownloading={urlDownloading} urlProgress={urlProgress}
              handleUrlInstall={handleUrlInstall}
              handleInstallWithPreview={handleInstallWithPreview}
            />
          )}

          {activeTab === 'modules' && (
            <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="w-6 h-6 border-2 border-slate-300 dark:border-slate-600 border-t-transparent rounded-full animate-spin" /></div>}>
            <ModulesTab
              t={t} lang={lang} modules={modules}
              activeModuleId={activeModuleId}
              handleModuleClick={handleModuleClick}
              handleToggleEnable={handleToggleEnable}
              handleUninstallLocalMod={handleUninstallLocalMod}
              setConfigEditorMod={setConfigEditorMod}
              newlyInstalledMods={newlyInstalledMods}
              searchQuery={searchQuery} setSearchQuery={setSearchQuery}
              filterType={filterType} setFilterType={setFilterType}
              sortBy={sortBy} setSortBy={setSortBy}
              batchMode={batchMode} setBatchMode={setBatchMode}
              selectedMods={selectedMods} setSelectedMods={setSelectedMods}
              handleBatchToggle={handleBatchToggle}
              handleBatchRemove={handleBatchRemove}
              handleToggleSelect={handleToggleSelect}
              isGameRunning={isGameRunning}
            />
            </Suspense>
          )}

          {activeTab === 'profiles' && (
            <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="w-6 h-6 border-2 border-slate-300 dark:border-slate-600 border-t-transparent rounded-full animate-spin" /></div>}>
            <ProfilesTab
              t={t} isDark={isDark} modules={modules}
              profiles={profiles} activeProfileId={activeProfileId}
              newProfileName={newProfileName} setNewProfileName={setNewProfileName}
              handleCreateProfile={handleCreateProfile}
              handleApplyProfile={handleApplyProfile}
              handleDeleteProfile={handleDeleteProfile}
              applyingProfileId={applyingProfileId}
            />
            </Suspense>
          )}

          {activeTab === 'settings' && (
            <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="w-6 h-6 border-2 border-slate-300 dark:border-slate-600 border-t-transparent rounded-full animate-spin" /></div>}>
            <SettingsTab
              t={t} lang={lang} isDark={isDark} themeId={themeId}
              toggleDark={toggleDark} changeTheme={changeTheme}
              gamePath={gamePath} detecting={detecting}
              handleDetectPath={handleDetectPath} handleBrowsePath={handleBrowsePath}
              handleConflictScan={handleConflictScan} handleOpenLogs={handleOpenLogs}
              handleRescan={handleRescan} rescanning={rescanning}
              appVersion={appVersion} updateState={updateState}
              updateInfo={updateInfo} updateProgress={updateProgress}
              handleCheckUpdate={handleCheckUpdate}
              handleDownloadUpdate={handleDownloadUpdate}
              handleInstallUpdate={handleInstallUpdate}
              backups={backups} backupLoading={backupLoading}
              handleBackup={handleBackup}
              handleListBackups={handleListBackups}
              handleRestoreBackup={handleRestoreBackup}
              handleDeleteBackup={handleDeleteBackup}
              nexusApiKey={nexusApiKey}
              handleSetNexusApiKey={handleSetNexusApiKey}
              minimizeToTray={minimizeToTray}
              handleSetMinimizeToTray={handleSetMinimizeToTray}
              autoStart={autoStart}
              handleSetAutoStart={handleSetAutoStart}
            />
            </Suspense>
          )}

          </div>
        </main>
      </div>

      {/* Global Overlays */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        description={confirmModal.description}
        onConfirm={confirmModal.onConfirm}
        onCancel={closeConfirm}
        t={t}
        confirmVariant={confirmModal.variant}
      />

      <ConfigEditorModal
        isOpen={!!configEditorMod}
        mod={configEditorMod}
        onClose={() => setConfigEditorMod(null)}
        t={t}
        lang={lang}
        addToast={addToast}
      />

      <ConflictModal
        isOpen={conflictModalOpen}
        onClose={() => setConflictModalOpen(false)}
        scanning={conflictScanning}
        conflicts={conflicts}
        t={t}
      />

      <LogModal
        isOpen={logModalOpen}
        onClose={() => setLogModalOpen(false)}
        loading={logLoading}
        logLines={logLines}
        onOpenLogFile={handleOpenLogFile}
        t={t}
      />

      <PreviewModal
        isOpen={showPreview}
        onClose={() => { setShowPreview(false); setPreviewData([]); setPendingInstallPaths([]); }}
        previews={previewData}
        loading={previewLoading}
        onConfirm={handleConfirmInstall}
        t={t}
      />

      <WorldSelectModal
        isOpen={worldSelectOpen}
        onClose={() => setWorldSelectOpen(false)}
        worlds={availableWorlds}
        loading={worldSelectLoading}
        onConfirm={handleConfirmBackup}
        t={t}
      />

      {/* Updating overlay */}
      {isUpdating && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative w-full max-w-xs bg-white/90 dark:bg-slate-900/90 backdrop-blur-2xl border border-white/60 dark:border-slate-700/50 rounded-[2rem] shadow-2xl p-8 flex flex-col items-center text-center gap-5 animate-modal-spring">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-4 border-slate-200 dark:border-slate-700" />
              <div className="absolute inset-0 rounded-full border-4 border-transparent animate-spin" style={{ borderTopColor: 'var(--accent-500)' }} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">{t.updatingTitle || 'Updating...'}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t.updatingDesc || 'Please wait, the app will restart shortly.'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
