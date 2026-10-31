import { useState, useEffect, useCallback } from 'react';

const ORDER_PREFIX_RE = /^(z+\d{1,2}|\d{3})_/i;

// Renderer copy of main's isPakFormOfMod (mods-order.ts): an on-disk pak
// filename, enabled or not, with or without a load-order prefix, is a form of
// the PAK mod `modName`.
function isPakFormOfMod(filename, modName) {
  if (typeof filename !== 'string' || typeof modName !== 'string' || !modName) return false;
  const enabledForm = filename.toLowerCase().replace(/\.disabled$/, '');
  const name = modName.toLowerCase();
  const candidates = new Set();
  for (const body of [`${name}_p`, name]) {
    for (const ext of ['pak', 'ucas', 'utoc']) candidates.add(`${body}.${ext}`);
  }
  return candidates.has(enabledForm) || candidates.has(enabledForm.replace(ORDER_PREFIX_RE, ''));
}

// Does the snapshot restore this card's mod? Snapshots list { name, modType }.
export function snapshotHoldsMod(snapshot, filename, type) {
  const mods = Array.isArray(snapshot?.mods) ? snapshot.mods : [];
  return mods.some(m => (type === 'UE4SS'
    ? m?.modType === 'UE4SS' && m.name === filename
    : m?.modType === 'PAK' && isPakFormOfMod(filename, m.name)));
}

// filename → Nexus source lookups shared by the link ("claim") and rollback
// features: which local mods already have a Nexus receipt, and which have an
// archived previous version to roll back to.
export function useNexusSources({ modules }) {
  const [linkedSet, setLinkedSet] = useState(() => new Set());
  const [rollbackMap, setRollbackMap] = useState(() => new Map());

  const refreshNexusSources = useCallback(async () => {
    if (!window.api?.nexus?.resolveProfileSources) return;
    try {
      const filenames = (modules || []).map(m => m.filename).filter(Boolean);
      const [sources, versions] = await Promise.all([
        filenames.length ? window.api.nexus.resolveProfileSources(filenames) : Promise.resolve([]),
        window.api.nexus.listModVersions ? window.api.nexus.listModVersions() : Promise.resolve({}),
      ]);
      // matchSourcesToMods returns filenames with `.disabled` stripped — card
      // lookups must strip the same way.
      const linked = new Set((sources || []).map(s => s.filename));
      const byMod = versions || {};
      const typeOf = new Map((modules || []).map(m => [String(m.filename || '').replace(/\.disabled$/i, ''), m.type]));
      const rb = new Map();
      for (const s of (sources || [])) {
        const list = byMod[String(s.modId)];
        if (!Array.isArray(list)) continue;
        // Newest first; a mod page's variants share the modId, so pick the
        // newest snapshot that holds THIS mod, not just the newest one.
        const snap = list.find(v => snapshotHoldsMod(v, s.filename, typeOf.get(s.filename)));
        if (snap) rb.set(s.filename, { modId: s.modId, ...snap });
      }
      setLinkedSet(linked);
      setRollbackMap(rb);
    } catch { /* keep the last known lookups */ }
  }, [modules]);

  useEffect(() => { refreshNexusSources(); }, [refreshNexusSources]);

  return { linkedSet, rollbackMap, refreshNexusSources };
}
