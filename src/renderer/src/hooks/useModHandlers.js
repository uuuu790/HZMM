import { useState, useCallback, useRef } from 'react';

export function useModHandlers({ addToast, showConfirm, t, isGameRunning, persistSetting }) {
  const [modules, setModules] = useState([]);
  const [newlyInstalledMods, setNewlyInstalledMods] = useState(new Set());
  const [activeModuleId, setActiveModuleId] = useState(null);

  // --- Search / Filter / Sort ---
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [sortBy, setSortBy] = useState('name');

  // --- Batch Mode ---
  const [batchMode, setBatchMode] = useState(false);
  const [selectedMods, setSelectedMods] = useState(new Set());

  // --- URL Install ---
  const [urlInput, setUrlInput] = useState('');
  const [urlDownloading, setUrlDownloading] = useState(false);
  const [urlProgress, setUrlProgress] = useState(0);

  // --- Preview ---
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pendingInstallPaths, setPendingInstallPaths] = useState([]);

  // --- Nexus ---
  const [nexusApiKey, setNexusApiKey] = useState('');

  // --- Drag & Drop ---
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // --- Refresh ---
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

  // --- Module Click ---
  const handleModuleClick = useCallback((modId) => {
    setActiveModuleId(prev => prev === modId ? null : modId);
  }, []);

  // --- Toggle Enable ---
  const handleToggleEnable = useCallback(async (filename) => {
    if (!window.api) return;
    const doToggle = async () => {
      try {
        const result = await window.api.mods.toggle(filename);
        await refreshMods();
        addToast(result.enabled ? t.toastEnabled : t.toastDisabled, 'success');
      } catch (err) { console.error('Toggle failed:', err); }
    };
    if (isGameRunning) {
      showConfirm(t.gameRunningWarning, t.gameRunningWarningDesc, doToggle, 'warning');
    } else {
      await doToggle();
    }
  }, [isGameRunning, t, refreshMods, addToast, showConfirm]);

  // --- Uninstall ---
  const handleUninstallLocalMod = useCallback((filename) => {
    const doRemove = async () => {
      await window.api.mods.remove(filename);
      await refreshMods();
      if (activeModuleId === filename) setActiveModuleId(null);
      addToast(t.toastUninstalled, 'warning');
    };
    if (isGameRunning) {
      showConfirm(t.gameRunningWarning, `${t.gameRunningWarningDesc}\n\n${t.confirmUninstallDesc}`, doRemove, 'danger');
    } else {
      showConfirm(t.confirmUninstallTitle, t.confirmUninstallDesc, doRemove);
    }
  }, [isGameRunning, activeModuleId, t, refreshMods, addToast, showConfirm]);

  // --- Install with Preview ---
  const doInstallPreview = useCallback(async (paths) => {
    setPendingInstallPaths(paths);
    setPreviewLoading(true);
    setShowPreview(true);
    try {
      const previews = await window.api.mods.preview(paths);
      setPreviewData(previews);
    } catch (err) {
      console.error('Preview failed:', err);
      setPreviewData([]);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const handleInstallWithPreview = useCallback(async (paths) => {
    if (!window.api || !paths?.length) return;
    if (isGameRunning) {
      showConfirm(t.gameRunningWarning, t.gameRunningWarningDesc, async () => {
        await doInstallPreview(paths);
      }, 'warning');
      return;
    }
    await doInstallPreview(paths);
  }, [isGameRunning, t, showConfirm, doInstallPreview]);

  const handleConfirmInstall = useCallback(async () => {
    if (!window.api || !pendingInstallPaths.length) return;
    setShowPreview(false);
    try {
      await window.api.mods.install(pendingInstallPaths);
      await refreshMods(true);
      addToast(t.toastInstalled, 'success');
    } catch (err) {
      console.error('Install failed:', err);
    }
    setPendingInstallPaths([]);
    setPreviewData([]);
  }, [pendingInstallPaths, t, refreshMods, addToast]);

  // --- Drop ---
  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (!window.api) return;
    const files = Array.from(e.dataTransfer?.files || []);
    const paths = files
      .map(f => window.api.system.getPathForFile(f))
      .filter(p => {
        if (!p) return false;
        const lower = p.toLowerCase();
        return lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.pak');
      });
    if (paths.length > 0) {
      await handleInstallWithPreview(paths);
    }
  }, [handleInstallWithPreview]);

  // --- Import Files ---
  const handleImportFiles = useCallback(async () => {
    if (!window.api) return;
    const files = await window.api.system.selectFiles();
    if (files && files.length > 0) {
      await handleInstallWithPreview(files);
    }
  }, [handleInstallWithPreview]);

  // --- URL Install ---
  const handleUrlInstall = useCallback(async (url) => {
    if (!window.api || !url?.trim()) return;
    setUrlDownloading(true);
    setUrlProgress(0);
    try {
      await window.api.mods.downloadUrl(url);
      await refreshMods(true);
      addToast(t.toastUrlInstalled || t.toastInstalled, 'success');
      setUrlInput('');
    } catch (err) {
      console.error('URL install failed:', err);
      if (err.message?.includes('NEXUS_API_KEY_REQUIRED')) {
        addToast(t.nexusApiKeyRequired || 'Please set your Nexus Mods API key in Settings', 'error');
      } else {
        addToast(err.message || 'Download failed', 'error');
      }
    } finally {
      setUrlDownloading(false);
      setUrlProgress(0);
    }
  }, [t, refreshMods, addToast]);

  const handleSetNexusApiKey = useCallback((key) => {
    setNexusApiKey(key);
    persistSetting('nexusApiKey', key);
  }, [persistSetting]);

  // --- Batch Operations ---
  const handleBatchToggle = useCallback(async (enable) => {
    if (!window.api || selectedMods.size === 0) return;
    for (const filename of selectedMods) {
      const mod = modules.find(m => m.filename === filename);
      if (mod && mod.enabled !== enable) {
        await window.api.mods.toggle(filename);
      }
    }
    await refreshMods();
    setSelectedMods(new Set());
    setBatchMode(false);
    addToast(enable ? t.toastEnabled : t.toastDisabled, 'success');
  }, [selectedMods, modules, t, refreshMods, addToast]);

  const handleBatchRemove = useCallback(() => {
    if (selectedMods.size === 0) return;
    showConfirm(t.confirmBatchDeleteTitle, t.confirmBatchDeleteDesc, async () => {
      for (const filename of selectedMods) {
        await window.api.mods.remove(filename);
      }
      await refreshMods();
      setSelectedMods(new Set());
      setBatchMode(false);
      addToast(t.toastUninstalled, 'warning');
    });
  }, [selectedMods, t, showConfirm, refreshMods, addToast]);

  const handleToggleSelect = useCallback((filename) => {
    setSelectedMods(prev => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }, []);

  // --- Init ---
  const initMods = useCallback(async () => {
    const mods = await window.api?.mods?.scan();
    if (mods) {
      prevModFilenames.current = new Set(mods.map(m => m.id || m.filename));
      setModules(mods);
    }
    const key = await window.api?.settings?.get('nexusApiKey', '');
    if (key) setNexusApiKey(key);
  }, []);

  return {
    // State
    modules, setModules,
    newlyInstalledMods,
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
    // Handlers
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
  };
}
