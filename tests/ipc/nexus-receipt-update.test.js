import { describe, it, expect } from 'vitest'
import { selectReceiptForUpdate, supersedeReceiptIn, mergeInstallReceipt } from '../../src/main/ipc/nexus-install-tracker'

// Receipts for one mod page hosting two independent variants plus the fixtures
// the update flow feeds selectReceiptForUpdate. Mirrors evaluateOutdated's
// same-name family rule: an update to a file is the newest upload among files
// SHARING ITS NAME, so the receipt it replaces is matched the same way.
const A = { modId: 42, fileId: 400, version: '1.0', localMods: [{ modType: 'PAK', name: 'CoolA' }] }
const B = { modId: 42, fileId: 500, version: '1.0', localMods: [{ modType: 'PAK', name: 'CoolB' }] }
const OTHER = { modId: 99, fileId: 1, localMods: [] }

const FILES = [
  { file_id: 400, name: 'Variant A' },
  { file_id: 401, name: 'Variant A' }, // A's successor
  { file_id: 500, name: 'Variant B' },
  { file_id: 501, name: 'Variant B' }, // B's successor
  { file_id: 700, name: 'Variant C' }, // never installed
]

describe('selectReceiptForUpdate', () => {
  it('returns null when the mod has no receipts', () => {
    expect(selectReceiptForUpdate([OTHER], 42, 401)).toBe(null)
    expect(selectReceiptForUpdate([], 42, 401)).toBe(null)
    expect(selectReceiptForUpdate(null, 42, 401)).toBe(null)
  })

  it('prefers the exact (modId, fileId) receipt — a reinstall of the same file', () => {
    expect(selectReceiptForUpdate([A, B], 42, 500)).toBe(B)
    expect(selectReceiptForUpdate([A, B], 42, 500, FILES)).toBe(B)
  })

  it('picks the same-name family receipt on multi-variant pages (never a sibling)', () => {
    // Regression: findReceipt used to return the FIRST receipt by modId, so
    // updating variant B snapshotted/archived variant A's files.
    expect(selectReceiptForUpdate([A, B], 42, 501, FILES)).toBe(B)
    expect(selectReceiptForUpdate([A, B], 42, 401, FILES)).toBe(A)
  })

  it('treats a different variant than anything installed as a fresh install (null)', () => {
    expect(selectReceiptForUpdate([A], 42, 700, FILES)).toBe(null)
    expect(selectReceiptForUpdate([A, B], 42, 700, FILES)).toBe(null)
  })

  it('accepts a lone legacy/link receipt without fileId as the update target', () => {
    const legacy = { modId: 42, fileId: null, localMods: [] }
    expect(selectReceiptForUpdate([legacy], 42, 401, FILES)).toBe(legacy)
    expect(selectReceiptForUpdate([legacy], 42, 401)).toBe(legacy)
    // ...but not when a fileId receipt exists alongside it.
    expect(selectReceiptForUpdate([A, legacy], 42, 700, FILES)).toBe(null)
  })

  it('without file metadata: a lone receipt is the target, several are ambiguous', () => {
    expect(selectReceiptForUpdate([A], 42, 401)).toBe(A)
    expect(selectReceiptForUpdate([A, B], 42, 401)).toBe(null)
    expect(selectReceiptForUpdate([A, B], 42, 401, [])).toBe(null)
  })

  it('matches by Nexus file group when the author renames every version (mods/143)', () => {
    const installed = { modId: 143, fileId: 545, localMods: [{ modType: 'PAK', name: 'bailing_4TierVehicleCamera_1.1X_v1.2.1' }] }
    const files = [
      { file_id: 545, group_id: 8036034, name: 'bailing 4TierVehicleCamera 1.1X v1.2.1' },
      { file_id: 569, group_id: 8036034, name: 'bailing 4TierVehicleCamera 1.1Z v1.3.0' },
    ]
    expect(selectReceiptForUpdate([installed], 143, 569, files)).toBe(installed)
  })

  it('picks the receipt in the incoming file\'s group, never a sibling variant (mods/34)', () => {
    const client2x = { modId: 34, fileId: 307, localMods: [{ modType: 'PAK', name: 'BoB2x' }] }
    const server2x = { modId: 34, fileId: 147, localMods: [{ modType: 'PAK', name: 'BoB2xServer' }] }
    const files = [
      { file_id: 307, group_id: 301456, name: 'Beast of Burden Enhancement2x' },
      { file_id: 147, group_id: 301462, name: 'Beast of Burden Enhancement2X FOR SERVER' },
      { file_id: 555, group_id: 301462, name: 'Beast of Burden Enhancement 90 FOR SERVER' },
      { file_id: 558, group_id: 301468, name: 'BACKPACK50' },
    ]
    expect(selectReceiptForUpdate([client2x, server2x], 34, 555, files)).toBe(server2x)
    // A variant nothing installed belongs to is a fresh install, not an update.
    expect(selectReceiptForUpdate([client2x, server2x], 34, 558, files)).toBe(null)
  })
})

describe('supersedeReceiptIn', () => {
  const NEW = { modId: 42, fileId: 401, version: '1.5', localMods: [{ modType: 'PAK', name: 'CoolA' }] }

  it('retires exactly the superseded receipt, keeping sibling variants', () => {
    // Regression: after an update recorded the new fileId, the OLD fileId's
    // receipt survived and kept evaluating as outdated forever (badge and
    // "Update all" never cleared).
    const out = supersedeReceiptIn([A, B, NEW, OTHER], 42, 400, 401)
    expect(out.map(r => [r.modId, r.fileId])).toEqual([[42, 500], [42, 401], [99, 1]])
  })

  it('moves claim-linked extra localMods onto the new receipt', () => {
    // A hand-installed file claimed via nexus:link-mod rides on the installed
    // receipt's localMods; retiring the receipt must not silently un-claim it.
    const claimed = { ...A, localMods: [...A.localMods, { modType: 'PAK', name: 'CoolAddon' }] }
    const out = supersedeReceiptIn([claimed, NEW], 42, 400, 401)
    expect(out).toHaveLength(1)
    expect(out[0].localMods).toEqual([
      { modType: 'PAK', name: 'CoolA' },
      { modType: 'PAK', name: 'CoolAddon' },
    ])
  })

  it('no-ops unless BOTH old and new receipts exist', () => {
    // Never drop tracking when the new receipt failed to record.
    expect(supersedeReceiptIn([A], 42, 400, 401)).toEqual([A])
    expect(supersedeReceiptIn([NEW], 42, 400, 401)).toEqual([NEW])
    expect(supersedeReceiptIn([A, NEW], 42, 400, 400)).toEqual([A, NEW])
  })

  it('retires a legacy fileId:null receipt when it was the update target', () => {
    const legacy = { modId: 42, fileId: null, localMods: [] }
    const out = supersedeReceiptIn([legacy, NEW], 42, null, 401)
    expect(out).toHaveLength(1)
    expect(out[0].fileId).toBe(401)
  })

  it('deduplicates carried PAK entries across load-order prefixes', () => {
    // The old receipt's conflict-renamed 'z1_CoolA' and the new receipt's
    // freshly landed 'CoolA' are the same pak — carrying both would leave a
    // permanent duplicate once restore re-applies the prefix.
    const old = { modId: 42, fileId: 400, localMods: [{ modType: 'PAK', name: 'z1_CoolA' }] }
    const out = supersedeReceiptIn([old, NEW], 42, 400, 401)
    expect(out).toHaveLength(1)
    expect(out[0].localMods).toEqual([{ modType: 'PAK', name: 'CoolA' }])
  })
})

describe('mergeInstallReceipt', () => {
  it('upserts by (modId, fileId), preserving sibling variant receipts', () => {
    const out = mergeInstallReceipt([A, B], 42, 400, [{ modType: 'PAK', name: 'CoolA' }], '2.0', 123)
    expect(out.map(r => [r.modId, r.fileId])).toEqual([[42, 500], [42, 400]])
    expect(out[1]).toMatchObject({ version: '2.0', installedAt: 123 })
  })

  it('absorbs a legacy (modId, null) receipt tracking the same files', () => {
    // nexus:install-mod records fileId:null; a later concrete install of the
    // same files must supersede it — otherwise the null receipt's installedAt
    // never advances and it flags outdated forever next to the concrete one.
    const nullR = { modId: 42, fileId: null, installedAt: 1, localMods: [{ modType: 'PAK', name: 'CoolA' }, { modType: 'PAK', name: 'ClaimedAddon' }] }
    const out = mergeInstallReceipt([nullR, B], 42, 401, [{ modType: 'PAK', name: 'CoolA' }], null, 2)
    expect(out.map(r => r.fileId)).toEqual([500, 401])
    // The claim-linked extra rides over to the concrete receipt.
    expect(out[1].localMods).toEqual([
      { modType: 'PAK', name: 'CoolA' },
      { modType: 'PAK', name: 'ClaimedAddon' },
    ])
  })

  it('keeps a null receipt that tracks DIFFERENT files', () => {
    const nullR = { modId: 42, fileId: null, installedAt: 1, localMods: [{ modType: 'PAK', name: 'Unrelated' }] }
    const out = mergeInstallReceipt([nullR], 42, 401, [{ modType: 'PAK', name: 'CoolA' }], null, 2)
    expect(out.map(r => r.fileId)).toEqual([null, 401])
  })

  it('absorption matches PAK names across load-order prefixes', () => {
    // Conflict-rename rewrites receipt names to z1_Cool while a fresh install
    // lands 'Cool' — still the same pak, so the null receipt must be absorbed
    // (and NOT duplicated into the new receipt's localMods).
    const nullR = { modId: 42, fileId: null, installedAt: 1, localMods: [{ modType: 'PAK', name: 'z1_Cool' }] }
    const out = mergeInstallReceipt([nullR], 42, 401, [{ modType: 'PAK', name: 'Cool' }], null, 2)
    expect(out).toHaveLength(1)
    expect(out[0].fileId).toBe(401)
    expect(out[0].localMods).toEqual([{ modType: 'PAK', name: 'Cool' }])
  })

  it('absorbs a pre-localMods legacy null receipt (field undefined)', () => {
    const legacy = { modId: 42, fileId: null, installedAt: 1 }
    const out = mergeInstallReceipt([legacy], 42, 401, [{ modType: 'PAK', name: 'CoolA' }], null, 2)
    expect(out).toHaveLength(1)
    expect(out[0].fileId).toBe(401)
  })

  it('a null-fileId install never absorbs anything', () => {
    const nullR = { modId: 42, fileId: null, installedAt: 1, localMods: [{ modType: 'PAK', name: 'CoolA' }] }
    const out = mergeInstallReceipt([nullR], 42, null, [{ modType: 'PAK', name: 'CoolA' }], null, 2)
    // Upsert replaces the old null receipt itself — one receipt remains.
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ fileId: null, installedAt: 2 })
  })
})
