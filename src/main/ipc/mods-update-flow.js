// Shared "update a mod IN PLACE" wrapper: snapshot the user-local state the
// reinstall would otherwise wipe (enabled/disabled + edited UE4SS configs),
// retain the outgoing version for one-click rollback, run the install, then
// re-apply the snapshot. Used by nexus:update-file and by the nxm:// handler
// when the incoming file belongs to an already-installed mod — so the
// free-account website flow ("Mod Manager Download" on a newer file) gets the
// exact same update semantics as the Premium one-click button.

import path from 'path'
import configStore from '../services/config-store.js'
import logger from '../services/logger.js'
import { serializeModWrite } from './mods-install.js'
import { captureModState, restoreModState } from './mods-update-state.js'
import { archiveModVersion } from './mod-versions.js'
import { renamePakEverywhere } from './mods-order.js'
import { invalidateCache } from './mods-scan.js'
import { getAllPaksPaths, getUe4ssModsPath } from '../services/steam-detector.js'

// The install receipt for a Nexus modId, or null. A receipt means HZMM
// installed (or claimed) this mod — i.e. an incoming file for it is an update.
export function findReceipt(modId) {
  const receipts = configStore.get('nexusInstalledMods', [])
  return (Array.isArray(receipts) ? receipts : []).find(r => r && r.modId === modId) || null
}

// Wrap `installFn` (which downloads + installs the new file and returns the
// install result) with the snapshot/restore + version-retention dance.
// Returns { result, restored } — restored is null when re-applying failed.
export async function runUpdateWithStateRestore(modId, installFn) {
  const gamePath = configStore.get('gamePath')
  if (!gamePath) throw new Error('Game path not set')
  const receipt = findReceipt(modId)
  const modPaths = { paksPaths: getAllPaksPaths(gamePath), ue4ssModsPath: getUe4ssModsPath(gamePath) }
  // Capture inside the write mutex so the snapshot sees a settled disk
  // state (never mid-toggle / mid-install).
  const prevState = await serializeModWrite(() => {
    // Retain the outgoing version for one-click rollback (newest 2 kept
    // per mod) BEFORE the install rotates the old files away.
    if (receipt) {
      try {
        archiveModVersion(modPaths, path.join(configStore.getConfigDir(), 'mod-versions'), receipt)
      } catch (err) {
        logger.warn(`update-flow: version archive failed: ${err.message}`)
      }
    }
    return captureModState(modPaths, receipt?.localMods || [])
  })
  const result = await installFn()
  // Restore is best-effort — the update itself succeeded; a partial
  // restore logs per entry and must not fail the whole operation.
  let restored = null
  try {
    restored = await serializeModWrite(() => restoreModState(modPaths, prevState, {
      // Re-applies a load-order prefix the reinstall dropped, migrating
      // the filename-keyed stores along with the on-disk rename.
      renamePak: (oldName, newName) => renamePakEverywhere(modPaths, oldName, newName),
    }))
    invalidateCache()
  } catch (err) {
    logger.warn(`update-flow: state restore failed: ${err.message}`)
  }
  return { result, restored }
}
