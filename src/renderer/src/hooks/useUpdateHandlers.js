import { useState, useCallback } from 'react';

export function useUpdateHandlers() {
  const [appVersion, setAppVersion] = useState('');
  const [updateState, setUpdateState] = useState('idle');
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState(null);

  const handleCheckUpdate = useCallback(async () => {
    if (!window.api) return;
    setUpdateError(null);
    setUpdateState('checking');
    try {
      const result = await window.api.appUpdate.check();
      // A failed check (offline, rate limit) resolves { hasUpdate: false, error }
      // rather than rejecting. It is not "up to date": go back to idle so the
      // Check button is offered again.
      if (result?.error) { setUpdateError(result.error); setUpdateState('idle'); }
      else if (result?.hasUpdate) { setUpdateInfo(result); setUpdateState('available'); }
      else { setUpdateState('latest'); }
    } catch (err) {
      setUpdateError(err?.message || 'Update check failed');
      setUpdateState('idle');
    }
  }, []);

  const handleDownloadUpdate = useCallback(async () => {
    if (!window.api) return;
    setUpdateError(null);
    setUpdateState('downloading');
    setUpdateProgress(0);
    const unsub = window.api.appUpdate.onProgress((p) => setUpdateProgress(p));
    try {
      await window.api.appUpdate.download(updateInfo?.downloadUrl, updateInfo?.expectedHash);
      setUpdateState('ready');
    } catch (err) {
      setUpdateError(err?.message || 'Update download failed');
      setUpdateState('available');
    } finally {
      unsub();
    }
  }, [updateInfo]);

  const handleInstallUpdate = useCallback(async () => {
    if (!window.api) return;
    setUpdateError(null);
    setIsUpdating(true);
    // On success the main process quits the app. If spawning the updater fails
    // (e.g. AV blocks cmd.exe) it won't quit — listen so the UI doesn't hang on
    // "installing" forever and the user can retry.
    const unsub = window.api.appUpdate.onInstallFailed((message) => {
      setIsUpdating(false);
      setUpdateState('ready');
      setUpdateError(message || 'Update install failed');
      unsub();
    });
    try {
      await window.api.appUpdate.install();
    } catch (err) {
      const message = err?.message || 'Update install failed';
      // Main reports a missing file (e.g. quarantined by AV) or deletes one that
      // failed re-verification: Install can never succeed again, so offer the
      // Download button instead of leaving the user on 'ready'.
      const needsDownload = /Update file not found|re-verification/i.test(message);
      setIsUpdating(false);
      setUpdateState(needsDownload && updateInfo ? 'available' : 'ready');
      setUpdateError(message);
      unsub();
    }
  }, [updateInfo]);

  const initVersion = useCallback(async () => {
    try { const ver = await window.api.appUpdate.getVersion(); setAppVersion(ver); } catch { /* ignore */ }
  }, []);

  return {
    appVersion, updateState, updateInfo, updateProgress, isUpdating, updateError,
    handleCheckUpdate, handleDownloadUpdate, handleInstallUpdate,
    initVersion,
  };
}
