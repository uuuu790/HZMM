import { useState, useCallback, useEffect, useRef } from 'react';
import { normalizeFilename, normalizeProfileFilenames, modIsInProfile, localISODate, sanitizeProfile, sanitizeProfiles } from './profile-utils.js';
import { classifyProfileMods } from './profile-nexus-utils.js';
import { notifyBackupsChanged } from './useBackupHandlers.js';

export function useProfileHandlers({ addToast, showConfirm, closeConfirm, t, modules, persistSetting, refreshMods }) {
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [applyingProfileId, setApplyingProfileId] = useState(null);
  const [importModal, setImportModal] = useState(null); // { profileId, missing, auto, manual, premium } | null
  const [importDownloading, setImportDownloading] = useState(false);
  const [importProgress, setImportProgress] = useState(null); // { current, total, name }
  // Guards against a double-submit (Enter pressed twice / double-click Create)
  // racing on the same profiles list and dropping one of the two new profiles.
  // handleCreateProfile awaits disk work before persisting, so without this a
  // second invocation would read the same list and overwrite the first.
  const creatingRef = useRef(false);
  // In-flight guard shared by every apply path. The applyingProfileId state
  // only blocks a click after a re-render, and the Nexus validate call before
  // an apply can take seconds, so a double-click used to run two applies.
  const applyingRef = useRef(false);
  // Bumped by every local write of the list (commitProfiles). A reload whose
  // settings.get went out before that write is answered with the pre-write
  // list, possibly after the write already set the state; loadProfiles uses
  // this to tell and drops that answer.
  const writeGenRef = useRef(0);
  // Stored profiles with a blank or non-text name (older imports accepted any
  // truthy name) get this name instead of being dropped from the store.
  const fallbackName = t?.profileUnnamed || 'Profile';

  // Main rewrites the stored profiles itself (renamePakEverywhere migrates
  // filenames on a load-order rename), so every read-modify-write starts from
  // the stored copy, never from this hook's possibly stale state.
  const readProfiles = useCallback(async () => {
    try {
      if (window.api?.settings?.get) {
        return sanitizeProfiles(await window.api.settings.get('profiles', []), { fallbackName });
      }
    } catch { /* fall back to the in-memory copy */ }
    return profiles;
  }, [profiles, fallbackName]);

  // State + store in one step. persistSetting sends settings:set right away,
  // so any settings.get sent after this call sees the new list.
  const commitProfiles = useCallback((updated) => {
    writeGenRef.current += 1;
    setProfiles(updated);
    persistSetting('profiles', updated);
  }, [persistSetting]);

  const loadProfiles = useCallback(async () => {
    // If a local write lands while the get is in flight, the answer predates
    // it: read again (that get is ordered after the write's settings:set).
    // Bounded; after the last try the state already holds the latest write.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const gen = writeGenRef.current;
      const saved = await window.api?.settings?.get('profiles', []);
      if (gen !== writeGenRef.current) continue;
      if (saved) setProfiles(sanitizeProfiles(saved, { fallbackName }));
      return;
    }
  }, [fallbackName]);

  // make-pak-win / apply-pak-order send mods:updated after migrating profiles.
  useEffect(() => {
    const unsub = window.api?.mods?.onUpdated?.(() => {
      loadProfiles().catch(() => { /* keep the current list */ });
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, [loadProfiles]);

  // Also re-read whenever the mod list is refreshed. The Nexus update flow
  // re-applies a dropped load-order prefix (migrating the stored profiles)
  // without sending mods:updated, but every update path ends in refreshMods.
  useEffect(() => {
    loadProfiles().catch(() => { /* keep the current list */ });
  }, [modules, loadProfiles]);

  const handleCreateProfile = useCallback(async () => {
    if (!newProfileName.trim() || creatingRef.current) return;
    creatingRef.current = true;
    try {
    // Store normalized base filenames so PAK state toggles don't break apply.
    const enabledFilenames = modules.filter(m => m.enabled).map(m => normalizeFilename(m.filename));
    let configSnapshot = null;
    try {
      if (window.api?.mods?.snapshotConfigs) {
        configSnapshot = await window.api.mods.snapshotConfigs();
      }
    } catch { /* ignore */ }
    // Capture each enabled mod's Nexus source now, while the mods are still on
    // disk to reverse-look-up. Lets applying this profile later — even on this
    // same machine after a mod was removed — auto-download what's missing,
    // without needing an export/import round-trip. Best-effort: no key needed
    // (pure local receipt + scan match), empty on failure.
    let nexusSources = [];
    try {
      nexusSources = await window.api?.nexus?.resolveProfileSources?.(enabledFilenames) || [];
    } catch { /* create without sources */ }
    const newProfile = {
      id: `profile-${Date.now()}`,
      name: newProfileName.trim(),
      enabledModFilenames: enabledFilenames,
      nexusSources,
      configSnapshot,
      createdAt: localISODate(),
    };
      commitProfiles([...(await readProfiles()), newProfile]);
      setNewProfileName('');
      addToast(t.toastProfileCreated, 'success');
    } finally {
      creatingRef.current = false;
    }
  }, [newProfileName, modules, readProfiles, commitProfiles, t, addToast]);

  // extraFailed: failures the caller already hit (e.g. downloads), so the
  // final toast reports a partial apply instead of a plain success.
  const applyProfileNow = useCallback(async (profile, extraFailed = 0) => {
    // Safety net: snapshot every world save before touching mod state (main
    // process keeps only the newest 5 auto-backups). Silent best-effort — a
    // failed backup must never block the apply.
    try {
      const res = await window.api.saves?.autoBackup?.();
      // Main also pruned old auto-backups; let the Settings list re-read.
      if (res && !res.skipped) notifyBackupsChanged();
    } catch { /* best-effort */ }
    const profileSet = normalizeProfileFilenames(profile.enabledModFilenames);
    // Reconcile against a FRESH scan rather than the render-time `modules`
    // snapshot. Two reasons the snapshot is unsafe here:
    //   1. Download-then-apply: importDownloadAndApply calls refreshMods() then
    //      us, but refreshMods only *schedules* setModules — this closure still
    //      holds the pre-download list, so newly downloaded mods would be missed.
    //   2. Hybrid mods: toggling a PAK also flips its linked UE4SS folder (and
    //      vice-versa) in the main process. Iterating a stale snapshot then acts
    //      on an outdated filename ("File not found", which used to abort the
    //      whole apply) or double-toggles the pair back off. So we re-scan after
    //      every toggle and skip mods already in the desired state.
    // Mod ids are stable across enable/disable (PAK id strips .disabled; UE4SS id
    // is `ue4ss:<dir>`), so we can iterate a fixed id list and re-resolve each.
    let live = (await window.api?.mods?.scan?.()) || modules;
    const ids = live.map(m => m.id);
    let failed = extraFailed;
    for (const id of ids) {
      const mod = live.find(m => m.id === id);
      if (!mod) continue; // vanished mid-apply (e.g. hybrid unlink)
      const shouldBeEnabled = modIsInProfile(profileSet, mod);
      if (mod.enabled === shouldBeEnabled) continue;
      try {
        await window.api.mods.toggle(mod.filename);
      } catch (err) {
        // A hybrid partner may have already brought this mod to the desired
        // state (or renamed its file) — log and continue instead of aborting;
        // count it so the toast can surface a partial apply.
        console.error('Profile apply: toggle failed for', mod.filename, err);
        failed += 1;
      }
      // Re-read live state so hybrid cross-toggles / PAK renames are reflected
      // before the next iteration decides whether to toggle.
      live = (await window.api?.mods?.scan?.()) || live;
    }
    try {
      if (profile.configSnapshot && window.api?.mods?.restoreConfigs) {
        await window.api.mods.restoreConfigs(profile.configSnapshot);
      }
    } catch { /* ignore */ }
    try { await refreshMods(); } catch { /* UI refresh is best-effort */ }
    setActiveProfileId(profile.id);
    persistSetting('activeProfileId', profile.id);
    addToast(
      failed > 0 ? `${t.toastProfileApplied} (${failed} ✕)` : t.toastProfileApplied,
      failed > 0 ? 'warning' : 'success'
    );
  }, [modules, refreshMods, persistSetting, t, addToast]);

  const handleApplyProfile = useCallback(async (profileId) => {
    if (!window.api || applyingRef.current) return;
    applyingRef.current = true;
    setApplyingProfileId(profileId);
    try {
      const profile = (await readProfiles()).find(p => p.id === profileId);
      if (!profile) return;

      // Detect mods the profile wants that aren't installed here.
      let premium = false;
      try { premium = (await window.api?.nexus?.validate?.())?.ok === true; } catch { /* offline */ }
      const { missing, auto, manual } = classifyProfileMods(profile, modules, premium);

      if (missing.length > 0) {
        // allMissing: none of the profile's mods are present locally, so applying
        // "anyway" would enable zero of them — the modal hides that option then.
        const wantedCount = (profile.enabledModFilenames || []).map(normalizeFilename).filter(Boolean).length;
        const allMissing = missing.length >= wantedCount;
        // Surface the modal; actual apply happens after the user chooses.
        setImportModal({ profileId, missing, auto, manual, premium, allMissing });
        return;
      }
      await applyProfileNow(profile);
    } finally {
      applyingRef.current = false;
      setApplyingProfileId(null);
    }
  }, [readProfiles, modules, applyProfileNow]);

  // Modal actions:
  const importDownloadAndApply = useCallback(async () => {
    const m = importModal;
    if (!m || applyingRef.current) return;
    applyingRef.current = true;
    setApplyingProfileId(m.profileId);
    setImportDownloading(true);
    // Collect mods whose pinned file was gone so we fell back to the latest main
    // file — applied below, then surfaced as a warning so the user knows those
    // versions may differ from what the profile originally captured.
    const drifted = [];
    const failed = [];
    try {
      const profile = (await readProfiles()).find(p => p.id === m.profileId);
      if (!profile) return;
      let i = 0;
      for (const s of m.auto) {
        i += 1;
        setImportProgress({ current: i, total: m.auto.length, name: s.displayName });
        try {
          if (Number.isInteger(s.fileId) && s.fileId > 0) {
            const res = await window.api.nexus.installFile(s.modId, s.fileId, s.version || undefined, true);
            if (res?.fellBackToLatest) drifted.push(s.displayName);
          } else {
            // Receipts from a one-click install or a "not sure" link have no
            // fileId, which install-file rejects: take the latest main file.
            await window.api.nexus.installMod(s.modId);
            drifted.push(s.displayName);
          }
        } catch (err) {
          // Continue with the rest; reported below and in the apply toast.
          console.error('Profile download failed for', s.displayName, err);
          failed.push(s.displayName);
        }
      }
      await refreshMods();
      await applyProfileNow(profile, failed.length);
    } finally {
      applyingRef.current = false;
      setApplyingProfileId(null);
      setImportDownloading(false);
      setImportProgress(null);
      setImportModal(null);
    }
    if (failed.length > 0) {
      addToast(`${t.nexusInstallFailedToast}: ${failed.join(', ')}`, 'warning');
    }
    if (drifted.length > 0) {
      addToast(`${t.toastProfileVersionDrift}${drifted.join(', ')}`, 'warning');
    }
  }, [importModal, readProfiles, refreshMods, applyProfileNow, addToast, t]);

  const importApplyAnyway = useCallback(async () => {
    const m = importModal;
    if (!m || applyingRef.current) return;
    setImportModal(null);
    applyingRef.current = true;
    setApplyingProfileId(m.profileId);
    try {
      const profile = (await readProfiles()).find(p => p.id === m.profileId);
      if (profile) await applyProfileNow(profile);
    } finally {
      applyingRef.current = false;
      setApplyingProfileId(null);
    }
  }, [importModal, readProfiles, applyProfileNow]);

  // Cancel: close the modal without applying anything (X / backdrop / Escape).
  const closeImportModal = useCallback(() => {
    if (!importDownloading) setImportModal(null);
  }, [importDownloading]);


  const handleDeleteProfile = useCallback((profileId) => {
    showConfirm(t.confirmDeleteProfileTitle, t.confirmDeleteProfileDesc, async () => {
      commitProfiles((await readProfiles()).filter(p => p.id !== profileId));
      if (activeProfileId === profileId) {
        setActiveProfileId(null);
        persistSetting('activeProfileId', null);
      }
      addToast(t.toastProfileDeleted, 'warning');
      closeConfirm();
    }, 'danger');
  }, [readProfiles, commitProfiles, activeProfileId, t, showConfirm, closeConfirm, addToast, persistSetting]);

  const handleExportProfile = useCallback(async (profileId) => {
    const profile = (await readProfiles()).find(p => p.id === profileId);
    if (!profile) return;
    // Attach where each enabled mod came from on Nexus, so importers can
    // auto-download the missing ones. Best-effort: on failure, export without.
    // Prefer the sources captured at creation time (taken while every mod was
    // present); fall back to a live reverse-lookup for older profiles that
    // predate creation-time capture.
    let nexusSources = Array.isArray(profile.nexusSources) && profile.nexusSources.length
      ? profile.nexusSources
      : [];
    if (!nexusSources.length) {
      try {
        nexusSources = await window.api?.nexus?.resolveProfileSources?.(profile.enabledModFilenames) || [];
      } catch { /* export without sources */ }
    }
    const exported = { ...profile, nexusSources };
    const data = JSON.stringify(exported, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${profile.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast(t.toastProfileExported, 'success');
  }, [readProfiles, t, addToast]);

  const handleImportProfile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        // Rejects a missing/blank name or a non-array enabledModFilenames, and
        // drops wrong-typed entries (e.g. a number filename) that would crash
        // the Profiles tab render or the apply path once persisted. No
        // fallbackName here: a file without a usable name is not accepted.
        const imported = sanitizeProfile(JSON.parse(text));
        if (!imported) {
          addToast(t.toastProfileImportError, 'error');
          return;
        }
        imported.id = Date.now().toString();
        imported.createdAt = localISODate();
        commitProfiles([...(await readProfiles()), imported]);
        addToast(t.toastProfileImported, 'success');
      } catch {
        addToast(t.toastProfileImportError, 'error');
      }
    };
    input.click();
  }, [readProfiles, commitProfiles, t, addToast]);

  const initProfiles = useCallback(async () => {
    await loadProfiles();
    const activeId = await window.api?.settings?.get('activeProfileId', null);
    if (activeId) setActiveProfileId(activeId);
  }, [loadProfiles]);

  return {
    profiles, setProfiles, activeProfileId, setActiveProfileId,
    newProfileName, setNewProfileName, applyingProfileId,
    handleCreateProfile, handleApplyProfile, handleDeleteProfile,
    handleExportProfile, handleImportProfile,
    importModal, importDownloading, importProgress,
    importDownloadAndApply, importApplyAnyway, closeImportModal,
    initProfiles,
  };
}
