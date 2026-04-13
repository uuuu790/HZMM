import { useState, useCallback, useEffect } from 'react';

export function useAppInit({ addToast, t, refreshMods }) {
  // --- Game ---
  const [gamePath, setGamePath] = useState(null);
  const [gameVersion, setGameVersion] = useState(null);
  const [isGameRunning, setIsGameRunning] = useState(false);
  // launchState: 'idle' | 'launching' | 'confirmed'
  const [launchState, setLaunchState] = useState('idle');
  const [detecting, setDetecting] = useState(false);

  // --- UE4SS ---
  const [ue4ssStatus, setUe4ssStatus] = useState('uninstalled');
  const [ue4ssProgress, setUe4ssProgress] = useState(0);
  const [ue4ssVersion, setUe4ssVersion] = useState(null);

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

  // --- Game running detection (every 5s, paused when hidden) ---
  useEffect(() => {
    if (!window.api) return;
    let intervalId = null;

    const check = async () => {
      try { setIsGameRunning(await window.api.game.isRunning()); } catch { /* transient — will retry next tick */ }
    };

    const startPolling = () => {
      if (intervalId) return;
      check();
      intervalId = setInterval(check, 5000);
    };

    const stopPolling = () => {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
    };

    // Defer first check
    const startId = setTimeout(startPolling, 3000);

    const unsub = window.api.system.onVisibilityChange?.((isVisible) => {
      if (isVisible) startPolling();
      else stopPolling();
    });

    return () => {
      clearTimeout(startId);
      stopPolling();
      if (unsub) unsub();
    };
  }, []);

  // --- UE4SS progress listener ---
  useEffect(() => {
    if (!window.api) return;
    const unsub = window.api.ue4ss.onProgress((progress) => { setUe4ssProgress(progress); });
    return unsub;
  }, []);

  // --- Handlers ---
  const handleDetectPath = useCallback(async () => {
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
  }, [detecting, refreshMods]);

  const handleBrowsePath = useCallback(async () => {
    if (!window.api) return;
    const folder = await window.api.system.selectFolder();
    if (!folder) return;

    const result = await window.api.game.setPath(folder);
    if (!result || result.valid) {
      // Old API (no return) or valid
      setGamePath(folder);
      await refreshMods();
    } else if (result.reason === 'select-subfolder' && result.suggestion) {
      // Auto-correct: they selected parent folder
      const fixed = await window.api.game.setPath(result.suggestion);
      if (!fixed || fixed.valid) {
        setGamePath(result.suggestion);
        await refreshMods();
        addToast(t.pathAutoCorrected || `Path corrected to: ${result.suggestion}`, 'info');
      }
    } else {
      addToast(t.pathInvalid || 'Selected folder is not a valid HumanitZ game directory', 'error');
    }
  }, [refreshMods, addToast, t]);

  // Launch state machine: idle → launching → confirmed → idle (isGameRunning takes over)
  useEffect(() => {
    if (isGameRunning && launchState === 'launching') {
      setLaunchState('confirmed');
      // Stay in confirmed briefly so checkmark shows at center, then reset
      const timer = setTimeout(() => setLaunchState('idle'), 1200);
      return () => clearTimeout(timer);
    }
  }, [isGameRunning, launchState]);

  const handleLaunch = useCallback(async () => {
    if (!window.api || isGameRunning || launchState !== 'idle') return;
    setLaunchState('launching');
    // Timeout fallback in case game detection fails
    const timeout = setTimeout(() => setLaunchState('idle'), 30000);
    try {
      await window.api.game.launch();
    } catch (err) {
      console.error('Launch failed:', err);
      setLaunchState('idle');
      clearTimeout(timeout);
    }
  }, [isGameRunning, launchState]);

  const handleUe4ssAction = useCallback(async () => {
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
  }, [ue4ssStatus, t, addToast]);

  const handleConflictScan = useCallback(async () => {
    setConflictModalOpen(true);
    setConflictScanning(true);
    try { const result = await window.api.conflicts.scan(); setConflicts(result || []); }
    catch { setConflicts([]); }
    setConflictScanning(false);
  }, []);

  const handleOpenLogs = useCallback(async () => {
    setLogModalOpen(true);
    setLogLoading(true);
    try { const lines = await window.api.logger.readRecent(); setLogLines(lines || []); }
    catch { setLogLines([]); }
    setLogLoading(false);
  }, []);

  const handleOpenLogFile = useCallback(async () => {
    if (!window.api) return;
    const p = await window.api.logger.getPath();
    if (p) window.api.system.openPath(p);
  }, []);

  const handleRescan = useCallback(async () => {
    if (!window.api || rescanning) return;
    setRescanning(true);
    try {
      await Promise.all([
        (async () => { await window.api.mods.invalidateCache(); await refreshMods(); })(),
        new Promise(r => setTimeout(r, 800)),
      ]);
    } finally { setRescanning(false); }
  }, [rescanning, refreshMods]);

  // --- Init game path + UE4SS ---
  const initGame = useCallback(async () => {
    const path = await window.api.game.detectPath();
    setGamePath(path);

    // Use cached version immediately (no network), refresh in background
    const cached = await window.api.game.getVersionCached();
    if (cached) setGameVersion(cached);

    // Run mod scan + UE4SS check in parallel (both local/fast)
    await Promise.all([
      path ? refreshMods() : Promise.resolve(),
      window.api.ue4ss.getStatus().then(status => { setUe4ssStatus(status.status); setUe4ssVersion(status.version || null); }).catch(() => {}),
    ]);

    // Background: fetch fresh version from Steam API (slow, don't block UI)
    window.api.game.getVersion().then(ver => { if (ver) setGameVersion(ver); }).catch(() => {});
  }, [refreshMods]);

  return {
    // State
    gamePath, setGamePath,
    gameVersion,
    isGameRunning, launchState,
    detecting,
    ue4ssStatus, ue4ssProgress, ue4ssVersion,
    isProcessing,
    conflictModalOpen, setConflictModalOpen,
    conflicts, conflictScanning,
    logModalOpen, setLogModalOpen,
    logLines, logLoading,
    rescanning,
    // Handlers
    handleDetectPath, handleBrowsePath, handleLaunch,
    handleUe4ssAction,
    handleConflictScan, handleOpenLogs, handleOpenLogFile,
    handleRescan,
    initGame,
  };
}
