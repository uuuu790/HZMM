// Search/filter helpers for the schema-driven config editor.
//
// Search is intentionally generous — it joins all human-readable surface for
// each key (keyName, sectionId, section label, key label, key description) and
// matches every space-separated term as a substring (AND logic). This lets a
// user type "AK47 damage" to land on BP_AK47Rifle.Damage even when the schema
// puts the weapon name in the section ID and the attribute name in the key
// label.

import {
  buildSectionKeyIndex, resolveEntryIdx,
  type ConfigEntry, type ConfigSchema, type SchemaKeyDef,
} from './config-parser';

export type KeyMatcher = (keyName: string, keyDef: SchemaKeyDef, sectionId: string, sectionLabel: string) => boolean;
export type KeyPredicate = (sectionId: string, keyName: string, keyDef: SchemaKeyDef) => boolean;

// config-parser's resolveI18n for schema text that is rendered or searched,
// but always a string: hzmm.config.json is untrusted, and `{"en": 5}` or
// `{"en": {}}` would reach `.replace()` / React as a number or an object and
// crash the editor.
export function schemaText(obj: unknown, lang: string): string {
  if (typeof obj === 'string') return obj;
  if (!obj || typeof obj !== 'object') return '';
  const o = obj as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  return str(o[lang]) || str(o.en) || str(Object.values(o).find(v => typeof v === 'string' && v !== ''));
}

// Build a (keyName, keyDef, sectionId, sectionLabel) → boolean matcher.
// Empty / whitespace-only query returns a matcher that accepts everything,
// so callers don't need a separate "no search" branch.
export function buildKeyMatcher(searchQuery: unknown, lang: string): KeyMatcher {
  const terms = String(searchQuery || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return () => true;
  return (keyName, keyDef, sectionId, sectionLabel) => {
    const haystack = [
      keyName,
      sectionId,
      sectionLabel,
      schemaText(keyDef.label, lang),
      schemaText(keyDef.description, lang),
    ].filter(Boolean).join(' ').toLowerCase();
    return terms.every(t => haystack.includes(t));
  };
}

// The schema keys the editor renders a row for: a key in the file, or an
// optional one (shown with its switch off). A non-optional key the file
// doesn't have gets no row, so search must not count it either.
export function renderableKeys(entries: ConfigEntry[]): KeyPredicate {
  const index = buildSectionKeyIndex(entries);
  return (sectionId, keyName, keyDef) => !!keyDef?.optional || resolveEntryIdx(index, sectionId, keyName) !== undefined;
}

// Walk the schema once and count how many keys pass the matcher.
// Used by the modal to render a "N / total" hint next to the search box.
// `isRenderable` (optional) leaves keys without a row out of both counts.
export function countSchemaMatches(
  schema: ConfigSchema | null | undefined,
  matcher: KeyMatcher,
  lang: string,
  isRenderable?: KeyPredicate,
): { matched: number; total: number } {
  if (!schema || !schema.sections) return { matched: 0, total: 0 };
  let matched = 0;
  let total = 0;
  for (const [sectionId, section] of Object.entries(schema.sections)) {
    const sectionLabel = schemaText(section.label, lang);
    for (const [keyName, keyDef] of Object.entries(section.keys || {})) {
      if (isRenderable && !isRenderable(sectionId, keyName, keyDef)) continue;
      total++;
      if (matcher(keyName, keyDef, sectionId, sectionLabel)) matched++;
    }
  }
  return { matched, total };
}
