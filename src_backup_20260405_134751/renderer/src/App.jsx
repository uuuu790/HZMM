import React, { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { Biohazard, CheckCircle, Settings, Play, Globe, Sun, Moon, ChevronDown, LayoutDashboard, Layers, Save, ExternalLink } from 'lucide-react';

// Constants
import { UI_TEXT } from './constants/i18n';
import { THEME_PRESETS, getTheme } from './constants/themes';

// Common components
import { ToastContainer, ConfirmModal } from './components/common';

// Modal components
import ConfigEditorModal from './components/modals/ConfigEditorModal';
import ConflictModal from './components/modals/ConflictModal';
import LogModal from './components/modals/LogModal';

// Tab components
import DashboardTab from './components/tabs/DashboardTab';
import ModulesTab from './components/tabs/ModulesTab';
import ProfilesTab from './components/tabs/ProfilesTab';
import SettingsTab from './components/tabs/SettingsTab';

// ==========================================
// App Styles (keyframes & utility classes)
// ==========================================

const APP_STYLES = `
  ::selection { background: rgba(var(--accent-rgb), 0.3); }
  ::view-transition-old(root),
  ::view-transition-new(root) {
    animation: none;
    mix-blend-mode: normal;
  }
  ::view-transition-old(root) { z-index: 1; }
  ::view-transition-new(root) { z-index: 9999; }
  @keyframes slideUpFade {
    0% { opacity: 0; transform: translateY(20px); }
    100% { opacity: 1; transform: translateY(0); }
  }
  @keyframes slideDownFade {
    0% { opacity: 0; transform: translateY(-20px); }
    100% { opacity: 1; transform: translateY(0); }
  }
  @keyframes zoomInFade {
    0% { opacity: 0; transform: scale(0.96); }
    100% { opacity: 1; transform: scale(1); }
  }
  @keyframes toastSlideIn {
    0% { opacity: 0; transform: translateX(100%) scale(0.9); }
    100% { opacity: 1; transform: translateX(0) scale(1); }
  }
  @keyframes modalSpring {
    0% { opacity: 0; transform: scale(0.85) translateY(10px); }
    50% { transform: scale(1.02) translateY(-2px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes orbFloat1 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    25% { transform: translate(3vw, -2vh) scale(1.05); }
    50% { transform: translate(-1vw, 3vh) scale(0.95); }
    75% { transform: translate(-3vw, -1vh) scale(1.03); }
  }
  @keyframes orbFloat2 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    33% { transform: translate(-4vw, 2vh) scale(1.04); }
    66% { transform: translate(2vw, -3vh) scale(0.97); }
  }
  @keyframes orbFloat3 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    20% { transform: translate(2vw, 3vh) scale(1.06); }
    60% { transform: translate(-3vw, -2vh) scale(0.96); }
    80% { transform: translate(1vw, 1vh) scale(1.02); }
  }
  @keyframes shimmerSweep {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(200%); }
  }
  @keyframes tabFadeIn {
    0% { opacity: 0; transform: translateY(8px) scale(0.995); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes logoBreath {
    0%, 100% { box-shadow: 0 0 15px rgba(var(--accent-rgb),0.3), 0 0 30px rgba(var(--accent-rgb),0.1); transform: scale(1); }
    50% { box-shadow: 0 0 25px rgba(var(--accent-rgb),0.5), 0 0 50px rgba(var(--accent-rgb),0.2); transform: scale(1.05); }
  }
  @keyframes toggleBounce {
    0% { transform: scale(1); }
    40% { transform: scale(1.3); }
    70% { transform: scale(0.9); }
    100% { transform: scale(1); }
  }
  @keyframes ripplePulse {
    0% { transform: scale(1); opacity: 0.4; }
    100% { transform: scale(2.5); opacity: 0; }
  }
  @keyframes countPop {
    0% { transform: scale(1); }
    50% { transform: scale(1.2); }
    100% { transform: scale(1); }
  }
  @keyframes launchRocket {
    0% { transform: translateY(0) rotate(0deg); }
    25% { transform: translateY(-3px) rotate(-5deg); }
    50% { transform: translateY(-6px) rotate(0deg); }
    75% { transform: translateY(-3px) rotate(5deg); }
    100% { transform: translateY(0) rotate(0deg); }
  }
  @keyframes langItemIn {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes emptyBreath {
    0%, 100% { transform: scale(1); opacity: 0.4; }
    50% { transform: scale(1.08); opacity: 0.6; }
  }
  @keyframes newModPulse {
    0% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0.5); }
    70% { box-shadow: 0 0 0 12px rgba(var(--accent-rgb), 0); }
    100% { box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0); }
  }
  @keyframes circularReveal {
    from { clip-path: circle(0% at var(--cx, 50%) var(--cy, 50%)); }
    to { clip-path: circle(150% at var(--cx, 50%) var(--cy, 50%)); }
  }
  .animate-slide-up { opacity: 0; animation: slideUpFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-slide-down { opacity: 0; animation: slideDownFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-zoom-in { opacity: 0; animation: zoomInFade 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-toast-in { animation: toastSlideIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
  .animate-modal-spring { animation: modalSpring 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
  .animate-tab-enter { animation: tabFadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .orb-float-1 { animation: orbFloat1 25s ease-in-out infinite; }
  .orb-float-2 { animation: orbFloat2 30s ease-in-out infinite; }
  .orb-float-3 { animation: orbFloat3 22s ease-in-out infinite; }
  .orb-float-4 { animation: orbFloat2 28s ease-in-out infinite reverse; }
  .shimmer-sweep::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
    animation: shimmerSweep 1.2s ease-in-out infinite;
  }
  .logo-breath { animation: logoBreath 3s ease-in-out infinite; }
  .toggle-bounce { animation: toggleBounce 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
  .count-pop { animation: countPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
  .launch-hover:hover .launch-icon { animation: launchRocket 0.6s ease-in-out infinite; }
  .launch-hover:hover .launch-glow { animation: ripplePulse 1.5s ease-out infinite; }
  .glass-glow {
    transition: background 0.4s ease;
    background: transparent;
  }
  .glass-glow:hover {
    background: radial-gradient(circle at var(--glow-x, 50%) var(--glow-y, 50%), rgba(var(--accent-rgb),0.06) 0%, transparent 60%);
  }
  .dark .glass-glow {
    background: transparent;
  }
  .dark .glass-glow:hover {
    background: radial-gradient(circle at var(--glow-x, 50%) var(--glow-y, 50%), rgba(var(--accent-rgb),0.08) 0%, transparent 60%);
  }
`;

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

  // --- i18n ---
  const t = UI_TEXT[lang];

  // --- Modules ---
  const [modules, setModules] = useState([]);
  const [newlyInstalledMods, setNewlyInstalledMods] = useState(new Set());
  const [activeTab, setActiveTab] = useState('dashboard');
  const [activeModuleId, setActiveModuleId] = useState(null);

  // --- UE4SS ---
  const [ue4ssStatus, setUe4ssStatus] = useState('uninstalled');
  const [ue4ssProgress, setUe4ssProgress] = useState(0);
  const [ue4ssVersion, setUe4ssVersion] = useState(null);

  // --- Game ---
  const [gamePath, setGamePath] = useState(null);
  const [gameVersion, setGameVersion] = useState(null);
  const [isGameRunning, setIsGameRunning] = useState(false);
  const [detecting, setDetecting] = useState(false);

  // --- Drag & Drop ---
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

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

  // --- Profiles ---
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [applyingProfileId, setApplyingProfileId] = useState(null);

  // --- App Update ---
  const [appVersion, setAppVersion] = useState('');
  const [updateState, setUpdateState] = useState('idle');
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(0);

  // --- Conflict & Log Modals ---
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [conflicts, setConflicts] = useState(null);
  const [conflictScanning, setConflictScanning] = useState(false);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logLines, setLogLines] = useState(null);
  const [logLoading, setLogLoading] = useState(false);

  // --- Cache Rescan ---
  const [rescanning, setRescanning] = useState(false);

  // --- Computed ---
  const isProcessing = ue4ssStatus === 'installing' || ue4ssStatus === 'updating';

  // ==========================================
  // Shared Helpers
  // ==========================================

  const prevModFilenames = useRef(new Set());
  const refreshMods = useCallback(async (trackNew = false) => {
    if (!window.api) return;
    const mods = await window.api.mods.scan();
    if (trackNew && prevModFilenames.current.size > 0) {
      const newMods = new Set();
      mods.forEach(m => {
        const key = m.id || m.filename;
        if (!prevModFilenames.current.has(key)) newMods.add(key);
      });
      if (newMods.size > 0) {
        setNewlyInstalledMods(newMods);
        setTimeout(() => setNewlyInstalledMods(new Set()), 2000);
      }
    }
    prevModFilenames.current = new Set(mods.map(m => m.id || m.filename));
    setModules(mods);
  }, []);

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

  // ==========================================
  // Initialization
  // ==========================================

  useEffect(() => {
    async function init() {
      if (!window.api) return;

      const savedLang = await window.api.locale.getPreference();
      const locales = await window.api.locale.getSupported();
      setLang(savedLang);
      setSupportedLocales(locales);

      const savedDark = await window.api.settings.get('darkMode', false);
      setIsDark(savedDark);

      const savedTheme = await window.api.settings.get('themeId', 'ember');
      setThemeId(savedTheme);

      const savedProfiles = await window.api.settings.get('profiles', []);
      const savedActiveProfileId = await window.api.settings.get('activeProfileId', null);
      setProfiles(Array.isArray(savedProfiles) ? savedProfiles : []);
      setActiveProfileId(savedActiveProfileId);

      const path = await window.api.game.detectPath();
      setGamePath(path);
      if (path) await refreshMods();

      try { const ver = await window.api.game.getVersion(); setGameVersion(ver); } catch { /* ignore */ }
      try { const status = await window.api.ue4ss.getStatus(); setUe4ssStatus(status.status); setUe4ssVersion(status.version || null); } catch { /* ignore */ }
      try { const ver = await window.api.appUpdate.getVersion(); setAppVersion(ver); } catch { /* ignore */ }
    }
    init();
  }, []);

  // Listen for mod updates
  useEffect(() => {
    if (!window.api) return;
    const unsub = window.api.mods.onUpdated(async () => { await refreshMods(true); });
    return unsub;
  }, []);

  // Listen for UE4SS progress
  useEffect(() => {
    if (!window.api) return;
    const unsub = window.api.ue4ss.onProgress((progress) => { setUe4ssProgress(progress); });
    return unsub;
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

  // Game running detection
  useEffect(() => {
    if (!window.api) return;
    const check = async () => {
      try { setIsGameRunning(await window.api.game.isRunning()); } catch {}
    };
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
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
    theme.orbs.light.forEach((c, i) => root.style.setProperty(`--orb-light-${i + 1}`, c));
    theme.orbs.dark.forEach((c, i) => root.style.setProperty(`--orb-dark-${i + 1}`, c));
  }, [themeId]);

  const changeLang = useCallback((code) => {
    setLang(code);
    setLangDropdownOpen(false);
    if (window.api) window.api.locale.setPreference(code);
  }, []);

  // ==========================================
  // Event Handlers
  // ==========================================

  const handleModuleClick = (modId) => {
    setActiveModuleId(prev => prev === modId ? null : modId);
  };

  const handleToggleEnable = async (filename) => {
    if (!window.api) return;
    try {
      const result = await window.api.mods.toggle(filename);
      await refreshMods();
      addToast(result.enabled ? t.toastEnabled : t.toastDisabled, result.enabled ? 'success' : 'info');
    } catch (err) { console.error('Toggle failed:', err); }
  };

  const handleUninstallLocalMod = (filename) => {
    showConfirm(t.confirmUninstallTitle, t.confirmUninstallDesc, async () => {
      if (!window.api) return;
      try {
        await window.api.mods.remove(filename);
        await refreshMods();
        if (activeModuleId === filename) setActiveModuleId(null);
        addToast(t.toastUninstalled, 'warning');
      } catch (err) { console.error('Uninstall failed:', err); }
      closeConfirm();
    });
  };

  const handleUe4ssAction = async () => {
    if (!window.api) return;
    const action = ue4ssStatus === 'uninstalled' ? 'install' : 'update';
    setUe4ssStatus(action === 'install' ? 'installing' : 'updating');
    setUe4ssProgress(0);
    try {
      const result = await window.api.ue4ss[action]();
      setUe4ssStatus('installed');
      if (result?.version) setUe4ssVersion(result.version);
      addToast(t.toastEngineDone, 'success');
    } catch (err) {
      console.error('UE4SS action failed:', err);
      setUe4ssStatus('uninstalled');
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (!window.api) return;
    const files = Array.from(e.dataTransfer?.files || []);
    const paths = files.map(f => f.path).filter(Boolean);
    if (paths.length > 0) {
      try {
        await window.api.mods.install(paths);
        addToast(t.toastInstalled, 'success');
      } catch (err) { console.error('Install failed:', err); }
    }
  };

  const handleImportFiles = async () => {
    if (!window.api) return;
    const files = await window.api.system.selectFiles();
    if (files && files.length > 0) {
      try {
        await window.api.mods.install(files);
        addToast(t.toastInstalled, 'success');
      } catch (err) { console.error('Install failed:', err); }
    }
  };

  const handleDetectPath = async () => {
    if (!window.api || detecting) return;
    setDetecting(true);
    try {
      const [path] = await Promise.all([
        window.api.game.detectPath(),
        new Promise(r => setTimeout(r, 800)),
      ]);
      setGamePath(path);
      if (path) await refreshMods();
    } finally {
      setDetecting(false);
    }
  };

  const handleBrowsePath = async () => {
    if (!window.api) return;
    const folder = await window.api.system.selectFolder();
    if (folder) {
      await window.api.game.setPath(folder);
      setGamePath(folder);
      await refreshMods();
    }
  };

  const handleLaunch = async () => {
    if (!window.api || isGameRunning) return;
    try { await window.api.game.launch(); } catch (err) { console.error('Launch failed:', err); }
  };

  // --- App Update ---
  const handleCheckUpdate = async () => {
    if (!window.api) return;
    setUpdateState('checking');
    try {
      const result = await window.api.appUpdate.check();
      if (result.hasUpdate) { setUpdateInfo(result); setUpdateState('available'); }
      else { setUpdateState('latest'); }
    } catch { setUpdateState('idle'); }
  };

  const handleDownloadUpdate = async () => {
    if (!window.api) return;
    setUpdateState('downloading');
    setUpdateProgress(0);
    const unsub = window.api.appUpdate.onProgress((p) => setUpdateProgress(p));
    try {
      await window.api.appUpdate.download(updateInfo?.downloadUrl);
      setUpdateState('ready');
    } catch { setUpdateState('available'); }
    unsub();
  };

  const handleInstallUpdate = async () => {
    if (!window.api) return;
    await window.api.appUpdate.install();
  };

  // --- Conflict Scan ---
  const handleConflictScan = async () => {
    setConflictModalOpen(true);
    setConflictScanning(true);
    try { const result = await window.api.conflicts.scan(); setConflicts(result || []); }
    catch { setConflicts([]); }
    setConflictScanning(false);
  };

  // --- Log Viewer ---
  const handleOpenLogs = async () => {
    setLogModalOpen(true);
    setLogLoading(true);
    try { const lines = await window.api.logger.readRecent(); setLogLines(lines || []); }
    catch { setLogLines([]); }
    setLogLoading(false);
  };

  const handleOpenLogFile = async () => {
    if (!window.api) return;
    const p = await window.api.logger.getPath();
    if (p) window.api.system.openPath(p);
  };

  // --- Cache Rescan ---
  const handleRescan = async () => {
    if (!window.api || rescanning) return;
    setRescanning(true);
    try {
      await Promise.all([
        (async () => { await window.api.mods.invalidateCache(); await refreshMods(); })(),
        new Promise(r => setTimeout(r, 800)),
      ]);
    } finally { setRescanning(false); }
  };

  // --- Profiles ---
  const handleCreateProfile = async () => {
    if (!newProfileName.trim()) return;
    const enabledFilenames = modules.filter(m => m.enabled).map(m => m.filename);
    let configSnapshot = null;
    try {
      if (window.api?.mods?.snapshotConfigs) {
        configSnapshot = await window.api.mods.snapshotConfigs();
      }
    } catch { /* ignore */ }
    const newProfile = {
      id: `profile-${Date.now()}`,
      name: newProfileName.trim(),
      enabledModFilenames: enabledFilenames,
      configSnapshot,
      createdAt: new Date().toISOString().split('T')[0],
    };
    const updated = [...profiles, newProfile];
    setProfiles(updated);
    setNewProfileName('');
    persistSetting('profiles', updated);
    addToast(t.toastProfileCreated, 'success');
  };

  const handleApplyProfile = async (profileId) => {
    if (!window.api || applyingProfileId) return;
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;
    setApplyingProfileId(profileId);
    try {
      for (const mod of modules) {
        const shouldBeEnabled = profile.enabledModFilenames.includes(mod.filename);
        if (mod.enabled !== shouldBeEnabled) {
          await window.api.mods.toggle(mod.filename);
        }
      }
      try {
        if (profile.configSnapshot && window.api?.mods?.restoreConfigs) {
          await window.api.mods.restoreConfigs(profile.configSnapshot);
        }
      } catch { /* ignore */ }
      await refreshMods();
      setActiveProfileId(profileId);
      persistSetting('activeProfileId', profileId);
      addToast(t.toastProfileApplied, 'success');
    } finally { setApplyingProfileId(null); }
  };

  const handleDeleteProfile = (profileId) => {
    showConfirm(t.confirmDeleteProfileTitle, t.confirmDeleteProfileDesc, () => {
      const updated = profiles.filter(p => p.id !== profileId);
      setProfiles(updated);
      persistSetting('profiles', updated);
      if (activeProfileId === profileId) {
        setActiveProfileId(null);
        persistSetting('activeProfileId', null);
      }
      addToast(t.toastProfileDeleted, 'warning');
      closeConfirm();
    }, 'danger');
  };

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
          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 logo-breath" style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-to))', boxShadow: '0 10px 15px -3px rgba(var(--accent-rgb), 0.3)' }}>
            <Biohazard className="text-white w-6 h-6 drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]" />
          </div>
          <h1 className="hidden lg:block ml-4 text-2xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-slate-800 to-slate-500 dark:from-white dark:to-slate-400 transition-colors duration-700">
            HMTZ
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
          <span className="hidden lg:block text-[10px] font-mono font-bold tracking-wider truncate">HMTZ Manager v{appVersion || '1.0.0'}</span>
        </div>
      </aside>

      {/* ============ Main Content ============ */}
      <div className="flex-1 flex flex-col h-screen overflow-y-auto relative z-10 p-4 pt-16 md:p-8 md:pt-16 md:pl-12 items-center [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400/80 dark:hover:[&::-webkit-scrollbar-thumb]:bg-slate-600/80 transition-colors scroll-smooth">

        <div className="absolute top-0 left-0 w-full h-12 [-webkit-app-region:drag]" />

        {/* Header */}
        <header className="w-full max-w-6xl flex justify-between items-center mb-8 z-30 relative animate-slide-down duration-700 select-none [-webkit-app-region:drag]">
          <h2 className="text-2xl font-light text-slate-600 dark:text-slate-400 tracking-wide flex items-center gap-3 transition-colors duration-700">
            <span className="text-slate-400 dark:text-slate-500 font-bold">HMTZ</span>
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
          <div key={activeTab} className="animate-tab-enter">

          {activeTab === 'dashboard' && (
            <DashboardTab
              t={t} modules={modules} isDark={isDark}
              isDragging={isDragging} setIsDragging={setIsDragging}
              fileInputRef={fileInputRef} handleDrop={handleDrop}
              handleImportFiles={handleImportFiles} addToast={addToast}
              ue4ssStatus={ue4ssStatus} ue4ssProgress={ue4ssProgress}
              ue4ssVersion={ue4ssVersion} isProcessing={isProcessing}
              handleUe4ssAction={handleUe4ssAction}
            />
          )}

          {activeTab === 'modules' && (
            <ModulesTab
              t={t} lang={lang} modules={modules}
              activeModuleId={activeModuleId}
              handleModuleClick={handleModuleClick}
              handleToggleEnable={handleToggleEnable}
              handleUninstallLocalMod={handleUninstallLocalMod}
              setConfigEditorMod={setConfigEditorMod}
              newlyInstalledMods={newlyInstalledMods}
            />
          )}

          {activeTab === 'profiles' && (
            <ProfilesTab
              t={t} isDark={isDark} modules={modules}
              profiles={profiles} activeProfileId={activeProfileId}
              newProfileName={newProfileName} setNewProfileName={setNewProfileName}
              handleCreateProfile={handleCreateProfile}
              handleApplyProfile={handleApplyProfile}
              handleDeleteProfile={handleDeleteProfile}
              applyingProfileId={applyingProfileId}
            />
          )}

          {activeTab === 'settings' && (
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
            />
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
    </div>
  );
}
