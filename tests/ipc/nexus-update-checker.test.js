import { describe, it, expect } from 'vitest';
import { evaluateOutdated } from '../../src/main/ipc/nexus-update-checker.js';

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

  it('falls back to receipt.version for currentVersion when the file is gone', () => {
    const v = evaluateOutdated({ modId: 1, fileId: 50, version: '0.9' }, [OLD_MAIN, NEW_MAIN]);
    expect(v.outdated).toBe(true); // latest (200) != installed (50)
    expect(v.currentVersion).toBe('0.9');
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
