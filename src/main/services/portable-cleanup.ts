import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'
import logger from './logger'

// The portable exe unpacks HZMM into %TEMP% on every start (~820 MB with the
// archive it unpacks from) and deletes all of it when the app exits — unless
// the launcher itself is killed first (Windows shutting down with HZMM in the
// tray, Task Manager), which leaves the whole lot behind, once per such exit.
// Sweep those leftovers on start: only folders the launcher makes (NSIS's
// ns*.tmp holding app\ or 7z-out\, and the fixed per-build folder builds
// before 1.7.2 unpacked into), only when they hold an HZMM copy, never our
// own, and only once untouched for an hour — a launch unpacking right now
// is always newer than that.

// Every fs call here goes through original-fs, Electron's untouched Node fs.
// Electron's own fs treats an .asar file as a folder: merely checking for a
// leftover's app.asar opens the archive and keeps it open for the life of
// the process, and deleting it then fails (EBUSY). Plain Node (the tests) has
// no such module, and its fs needs no workaround.
const pfs: typeof fs = (() => {
  try {
    return createRequire(__filename)('original-fs') as typeof fs
  } catch {
    return fs
  }
})()

const EXE = 'HZMM Manager.exe'
const NSIS_DIR_RE = /^ns[0-9a-z]+\.tmp$/i
const KSUID_DIR_RE = /^[0-9a-z]{27}$/i
export const STALE_UNPACK_MIN_AGE_MS = 60 * 60 * 1000

function holdsHzmm(dir: string): boolean {
  return pfs.existsSync(path.join(dir, EXE)) && pfs.existsSync(path.join(dir, 'resources', 'app.asar'))
}

function isLauncherFolder(dir: string, name: string): boolean {
  if (NSIS_DIR_RE.test(name)) return holdsHzmm(path.join(dir, 'app')) || holdsHzmm(path.join(dir, '7z-out'))
  if (KSUID_DIR_RE.test(name)) return holdsHzmm(dir)
  return false
}

const within = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Leftover HZMM unpack folders under `tempDirs`: launcher-made, not holding `ownExe`, idle ≥ minAgeMs. */
export function findStalePortableUnpacks(tempDirs: string[], ownExe: string, now = Date.now(), minAgeMs = STALE_UNPACK_MIN_AGE_MS): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  for (const temp of tempDirs) {
    let names: string[]
    try { names = pfs.readdirSync(temp) } catch { continue }
    for (const name of names) {
      const dir = path.join(temp, name)
      const key = path.resolve(dir).toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      try {
        const stat = pfs.statSync(dir)
        if (!stat.isDirectory() || now - stat.mtimeMs < minAgeMs) continue
        if (within(path.resolve(ownExe), path.resolve(dir))) continue
        if (isLauncherFolder(dir, name)) found.push(dir)
      } catch { /* vanished or unreadable — leave it */ }
    }
  }
  return found
}

// The launcher's %TEMP% is three levels above our exe (<TEMP>\ns*.tmp\app\);
// os.tmpdir() is the same folder unless TEMP and TMP disagree.
export async function sweepStalePortableUnpacks(): Promise<void> {
  const ownExe = process.execPath
  const tempDirs = [os.tmpdir()]
  if (NSIS_DIR_RE.test(path.basename(path.dirname(path.dirname(ownExe))))) {
    tempDirs.push(path.dirname(path.dirname(path.dirname(ownExe))))
  }
  for (const dir of findStalePortableUnpacks(tempDirs, ownExe)) {
    try {
      await pfs.promises.rm(dir, { recursive: true, force: true, maxRetries: 2 })
      logger.info(`Removed a leftover portable unpack folder: ${dir}`)
    } catch (err) {
      logger.warn(`Could not remove leftover unpack folder ${dir}: ${(err as Error).message}`)
    }
  }
}
