import { useState, useCallback, useEffect } from 'react';

// Fired by code outside this hook that creates or prunes backups behind its
// back (the auto-backup taken before a profile apply), so the list re-reads.
const BACKUPS_CHANGED_EVENT = 'hzmm:backups-changed';
export function notifyBackupsChanged() {
  window.dispatchEvent(new Event(BACKUPS_CHANGED_EVENT));
}

const ipcErrorMessage = (err) =>
  String(err?.message || err || '').replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/, '');

export function useBackupHandlers({ addToast, showConfirm, t }) {
  const [backups, setBackups] = useState([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [worldSelectOpen, setWorldSelectOpen] = useState(false);
  const [worldSelectLoading, setWorldSelectLoading] = useState(false);
  const [availableWorlds, setAvailableWorlds] = useState([]);

  const handleBackup = useCallback(async () => {
    if (!window.api?.saves) return;
    setWorldSelectLoading(true);
    setWorldSelectOpen(true);
    try {
      const worlds = await window.api.saves.listWorlds();
      setAvailableWorlds(worlds);
    } catch (err) {
      console.error('List worlds failed:', err);
      setAvailableWorlds([]);
    } finally {
      setWorldSelectLoading(false);
    }
  }, []);

  const handleConfirmBackup = useCallback(async (worldNames) => {
    setWorldSelectOpen(false);
    if (!window.api?.saves || !worldNames.length) return;
    setBackupLoading(true);
    try {
      await window.api.saves.backup(worldNames);
      addToast(t.toastBackupSuccess, 'success');
      const list = await window.api.saves.listBackups();
      setBackups(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Backup failed:', err);
      addToast(t.toastBackupFailed || err.message, 'error');
    } finally {
      setBackupLoading(false);
    }
  }, [t, addToast]);

  const handleListBackups = useCallback(async () => {
    if (!window.api?.saves) return;
    const list = await window.api.saves.listBackups();
    setBackups(Array.isArray(list) ? list : []);
  }, []);

  const handleRestoreBackup = useCallback((backupPath) => {
    showConfirm(t.confirmRestoreTitle, t.confirmRestoreDesc, async () => {
      try {
        await window.api.saves.restoreBackup(backupPath);
        addToast(t.toastRestoreSuccess, 'success');
        const list = await window.api.saves.listBackups();
        setBackups(Array.isArray(list) ? list : []);
      } catch (err) {
        console.error('Restore failed:', err);
        addToast(err.message || 'Restore failed', 'error');
      }
    });
  }, [t, showConfirm, addToast]);

  const handleDeleteBackup = useCallback((backupPath) => {
    showConfirm(t.confirmDeleteBackupTitle || t.confirmTitle, t.confirmDeleteBackupDesc || t.confirmUninstallDesc, async () => {
      let ok = false;
      let reason = '';
      try {
        // false: main refused (path gone or outside the backups dir).
        ok = await window.api.saves.deleteBackup(backupPath) !== false;
      } catch (err) {
        // e.g. EBUSY/EPERM on Windows while Explorer or AV holds the folder.
        console.error('Delete backup failed:', err);
        reason = ipcErrorMessage(err);
      }
      try {
        const list = await window.api.saves.listBackups();
        setBackups(Array.isArray(list) ? list : []);
      } catch { /* keep the current list */ }
      if (ok) addToast(t.toastBackupDeleted || t.toastUninstalled, 'success');
      else addToast(reason ? `${t.toastBackupDeleteFailed}: ${reason}` : t.toastBackupDeleteFailed, 'error');
    });
  }, [t, showConfirm, addToast]);

  useEffect(() => {
    const onChanged = () => { handleListBackups().catch(() => { /* keep the current list */ }); };
    window.addEventListener(BACKUPS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(BACKUPS_CHANGED_EVENT, onChanged);
  }, [handleListBackups]);

  const initBackups = useCallback(async () => {
    if (window.api?.saves?.listBackups) {
      const list = await window.api.saves.listBackups();
      setBackups(Array.isArray(list) ? list : []);
    }
  }, []);

  return {
    backups, backupLoading,
    worldSelectOpen, setWorldSelectOpen,
    worldSelectLoading, availableWorlds,
    handleBackup, handleConfirmBackup, handleListBackups,
    handleRestoreBackup, handleDeleteBackup,
    initBackups,
  };
}
