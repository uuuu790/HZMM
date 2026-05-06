import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execAsync = promisify(exec)

const KNOWN_EXE_NAMES = [
  'HumanitZ-Win64-Shipping.exe',
  'HumanitZ.exe'
]

const VALID_EXE_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/

// Parse the CSV output of `tasklist /FO CSV /NH` and decide whether the
// expected exe name appears as a running process. Each line looks like:
//   "HumanitZ-Win64-Shipping.exe","12345","Console","1","123,456 K"
// First field is the image name (quoted, possibly with quirks). Match is
// case-insensitive because Windows process names are.
//
// Exported for unit testing — the real isGameRunning shells out to tasklist
// which can't be exercised cheaply outside Windows.
export function parseTasklistOutput(stdout, expectedExeName) {
  if (typeof stdout !== 'string' || !expectedExeName) return false
  const lines = stdout.trim().split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^"([^"]*)"/)
    if (match && match[1].toLowerCase() === expectedExeName.toLowerCase()) {
      return true
    }
  }
  return false
}

async function isGameRunning(gameExePath) {
  const exeNames = [...KNOWN_EXE_NAMES]
  if (gameExePath) {
    const exeName = path.basename(gameExePath)
    if (!exeNames.includes(exeName)) {
      exeNames.unshift(exeName)
    }
  }

  for (const exeName of exeNames) {
    // Skip exe names with invalid characters to prevent command injection
    if (!VALID_EXE_NAME_PATTERN.test(exeName)) {
      continue
    }

    try {
      const { stdout } = await execAsync(
        `tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`,
        { encoding: 'utf-8', windowsHide: true, timeout: 3000 }
      )
      if (parseTasklistOutput(stdout, exeName)) return true
    } catch {
      continue
    }
  }

  return false
}

export { isGameRunning }
