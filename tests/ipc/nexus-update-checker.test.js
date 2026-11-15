import { describe, it, expect } from 'vitest';
import { evaluateOutdated } from '../../src/main/ipc/nexus-update-checker';

// V2 file fixtures (category_id 1 = main). uploaded_timestamp arrives as an
// ISO string from the V2 GraphQL `date` field.
const OLD_MAIN = { file_id: 100, version: '1.0', category_id: 1, uploaded_timestamp: '2024-01-01T00:00:00Z' };
const NEW_MAIN = { file_id: 200, version: '1.5', category_id: 1, uploaded_timestamp: '2024-06-01T00:00:00Z' };
const OPTIONAL = { file_id: 300, version: '9.9', category_id: 4, category_name: 'Optional', uploaded_timestamp: '2024-12-01T00:00:00Z' };

describe('evaluateOutdated — installed a specific fileId', () => {
  it('flags outdated when a newer main file exists', () => {
    const v = evaluateOutdated({ modId: 1, fileId: 100 }, [OLD_MAIN, NEW_MAIN]);
    expect(v.outdated).toBe(true);
    expect(v.latestFileId).toBe(200);
    expect(v.latestVersion).toBe('1.5');
    expect(v.currentVersion).toBe('1.0');
  });

  it('is up-to-date when the installed file IS the latest main', () => {
    const v = evaluateOutdated({ modId: 1, fileId: 200 }, [OLD_MAIN, NEW_MAIN]);
    expect(v.outdated).toBe(false);
    expect(v.currentVersion).toBe('1.5');
  });

  it('ignores a newer OPTIONAL file — only main files count', () => {
    const v = evaluateOutdated({ modId: 1, fileId: 200 }, [OLD_MAIN, NEW_MAIN, OPTIONAL]);
    expect(v.outdated).toBe(false);
    expect(v.latestFileId).toBe(200);
  });

  it('does NOT flag when the installed file is gone from the list (no identifiable successor)', () => {
    const v = evaluateOutdated({ modId: 1, fileId: 50, version: '0.9' }, [OLD_MAIN, NEW_MAIN]);
    expect(v.outdated).toBe(false); // installed file delisted — don't guess a successor
    expect(v.currentVersion).toBe('0.9');
  });

  it('does NOT flag a different-named variant on a multi-file modId page', () => {
    const mine = { file_id: 10, name: 'Backpack50', version: '1.0', category_id: 1, uploaded_timestamp: '2024-01-01T00:00:00Z' };
    const other = { file_id: 20, name: 'Beast of Burden', version: '1.0', category_id: 1, uploaded_timestamp: '2024-09-01T00:00:00Z' };
    expect(evaluateOutdated({ modId: 1, fileId: 10 }, [mine, other]).outdated).toBe(false);
  });

  it('flags a SAME-named newer upload and targets that file, not the page newest', () => {
    const old = { file_id: 10, name: 'Backpack50', version: '1.0', category_id: 1, uploaded_timestamp: '2024-01-01T00:00:00Z' };
    const updated = { file_id: 30, name: 'Backpack50', version: '1.1', category_id: 1, uploaded_timestamp: '2024-09-01T00:00:00Z' };
    const other = { file_id: 20, name: 'Beast of Burden', version: '2.0', category_id: 1, uploaded_timestamp: '2024-12-01T00:00:00Z' };
    const v = evaluateOutdated({ modId: 1, fileId: 10 }, [old, updated, other]);
    expect(v.outdated).toBe(true);
    expect(v.latestFileId).toBe(30);
  });
});

describe('evaluateOutdated — installed "latest" (fileId null)', () => {
  it('flags outdated when a main file is newer than installedAt', () => {
    const v = evaluateOutdated({ modId: 1, fileId: null, installedAt: Date.parse('2024-03-01T00:00:00Z') }, [OLD_MAIN, NEW_MAIN]);
    expect(v.outdated).toBe(true);
    expect(v.latestVersion).toBe('1.5');
  });

  it('is up-to-date when installedAt is newer than every main file', () => {
    const v = evaluateOutdated({ modId: 1, fileId: null, installedAt: Date.parse('2024-07-01T00:00:00Z') }, [OLD_MAIN, NEW_MAIN]);
    expect(v.outdated).toBe(false);
  });
});

// Real file lists probed from the Nexus V2 API on 2026-11-15 (date = unix
// seconds, as V2 sends it). groupId is Nexus's own "update of this file" chain.
const ts = (iso) => Date.parse(iso) / 1000;

// mods/143 "Bailing 4-Tier Vehicle Camera": the author renames EVERY version,
// but each is uploaded as an update of the same file (one group).
const VEHICLE_CAM = [
  { file_id: 472, group_id: 8036034, name: 'Bailing 4 TierVehicleCamera 1.1EB03 V1.0.0', version: '1', category_id: 7, category_name: 'ARCHIVED', uploaded_timestamp: ts('2026-09-27T08:05:00Z') },
  { file_id: 515, group_id: 8036034, name: 'bailing 4TierVehicleCamera 1.1Spooky v1.1.0', version: '2', category_id: 7, category_name: 'ARCHIVED', uploaded_timestamp: ts('2026-10-20T05:03:00Z') },
  { file_id: 540, group_id: 8036034, name: 'bailing 4TierVehicleCamera 1.1X v1.2.0', version: '3', category_id: 7, category_name: 'ARCHIVED', uploaded_timestamp: ts('2026-10-31T01:53:00Z') },
  { file_id: 545, group_id: 8036034, name: 'bailing 4TierVehicleCamera 1.1X v1.2.1', version: '4', category_id: 4, category_name: 'OLD_VERSION', uploaded_timestamp: ts('2026-11-04T11:37:00Z') },
  { file_id: 569, group_id: 8036034, name: 'bailing 4TierVehicleCamera 1.1Z v1.3.0', version: '5', category_id: 1, category_name: 'MAIN', uploaded_timestamp: ts('2026-11-12T09:15:00Z') },
];

// mods/34 (subset): one page, independent variants — each its own group. The
// server 2X variant was renamed to "90 FOR SERVER" inside its group.
const BACKPACK_PAGE = [
  { file_id: 307, group_id: 301456, name: 'Beast of Burden Enhancement2x', version: '1.03.B', category_id: 1, category_name: 'MAIN', uploaded_timestamp: ts('2026-04-05T00:00:00Z') },
  { file_id: 308, group_id: 301459, name: 'Beast of Burden Enhancement3x', version: '1.03.B', category_id: 1, category_name: 'MAIN', uploaded_timestamp: ts('2026-04-05T00:00:00Z') },
  { file_id: 147, group_id: 301462, name: 'Beast of Burden Enhancement2X FOR SERVER', version: '1.0-1', category_id: 4, category_name: 'OLD_VERSION', uploaded_timestamp: ts('2026-02-13T00:00:00Z') },
  { file_id: 321, group_id: 301462, name: 'Beast of Burden Enhancement 90 FOR SERVER', version: '1.03.B', category_id: 7, category_name: 'ARCHIVED', uploaded_timestamp: ts('2026-04-08T00:00:00Z') },
  { file_id: 555, group_id: 301462, name: 'Beast of Burden Enhancement 90 FOR SERVER', version: '1.1C', category_id: 3, category_name: 'OPTIONAL', uploaded_timestamp: ts('2026-11-10T00:00:00Z') },
  { file_id: 558, group_id: 301468, name: 'BACKPACK50', version: '1.1C', category_id: 1, category_name: 'MAIN', uploaded_timestamp: ts('2026-11-10T00:00:00Z') },
];

describe('evaluateOutdated — Nexus file groups (renamed versions)', () => {
  it('flags a renamed newer version in the same group (mods/143 1.1X v1.2.1 -> 1.1Z v1.3.0)', () => {
    const v = evaluateOutdated({ modId: 143, fileId: 545 }, VEHICLE_CAM);
    expect(v.outdated).toBe(true);
    expect(v.latestFileId).toBe(569);
    expect(v.latestVersion).toBe('5');
    expect(v.currentVersion).toBe('4');
  });

  it('flags it even when the installed version has since been archived', () => {
    const v = evaluateOutdated({ modId: 143, fileId: 540 }, VEHICLE_CAM);
    expect(v.outdated).toBe(true);
    expect(v.latestFileId).toBe(569);
  });

  it('is up-to-date on the newest version of the group', () => {
    expect(evaluateOutdated({ modId: 143, fileId: 569 }, VEHICLE_CAM).outdated).toBe(false);
  });

  it('never crosses variants: a newer main file in ANOTHER group is not an update', () => {
    const v = evaluateOutdated({ modId: 34, fileId: 307 }, BACKPACK_PAGE);
    expect(v.outdated).toBe(false);
    expect(v.latestFileId).toBe(307);
  });

  it('follows a variant renamed inside its group, skipping its archived upload', () => {
    const v = evaluateOutdated({ modId: 34, fileId: 147 }, BACKPACK_PAGE);
    expect(v.outdated).toBe(true);
    expect(v.latestFileId).toBe(555);
    expect(v.latestVersion).toBe('1.1C');
  });

  it('never offers a withdrawn (archived) upload as the update', () => {
    const mine = { file_id: 1, group_id: 9, name: 'X v1', version: '1', category_id: 4, uploaded_timestamp: ts('2026-01-01T00:00:00Z') };
    const pulled = { file_id: 2, group_id: 9, name: 'X v2', version: '2', category_id: 7, category_name: 'ARCHIVED', uploaded_timestamp: ts('2026-02-01T00:00:00Z') };
    expect(evaluateOutdated({ modId: 1, fileId: 1 }, [mine, pulled]).outdated).toBe(false);
  });

  it('still follows a same-named re-upload that started a NEW group', () => {
    const v1 = { file_id: 10, group_id: 100, name: 'Cool Mod', version: '1.0', category_id: 4, uploaded_timestamp: ts('2026-01-01T00:00:00Z') };
    const v2 = { file_id: 11, group_id: 200, name: 'Cool Mod', version: '2.0', category_id: 1, uploaded_timestamp: ts('2026-03-01T00:00:00Z') };
    const v = evaluateOutdated({ modId: 1, fileId: 10 }, [v1, v2]);
    expect(v.outdated).toBe(true);
    expect(v.latestFileId).toBe(11);
  });
});

describe('evaluateOutdated — edge cases', () => {
  it('is not outdated when the mod has no files (delisted / empty)', () => {
    expect(evaluateOutdated({ modId: 1, fileId: 100 }, []).outdated).toBe(false);
    expect(evaluateOutdated({ modId: 1, fileId: 100 }, null).outdated).toBe(false);
  });

  it('uses the whole list when no file is tagged main', () => {
    const a = { file_id: 1, version: 'a', category_id: 4, uploaded_timestamp: '2024-01-01T00:00:00Z' };
    const b = { file_id: 2, version: 'b', category_id: 4, uploaded_timestamp: '2024-06-01T00:00:00Z' };
    const v = evaluateOutdated({ modId: 1, fileId: 1 }, [a, b]);
    expect(v.outdated).toBe(true);
    expect(v.latestFileId).toBe(2);
  });
});
