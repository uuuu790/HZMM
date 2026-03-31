import { execSync } from 'child_process'
import path from 'path'

const KNOWN_EXE_NAMES = [
  'HumanitZ-Win64-Shipping.exe',
  'HumanitZ.exe'
]

const VALID_EXE_NAME_PATTERN = /^[a-zA-Z0-9._\-]+$/

function isGameRunning(gameExePath) {
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
      const output = execSync(
        `tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`,
        { encoding: 'utf-8', windowsHide: true, timeout: 3000 }
      )
      // Parse CSV output — each line has quoted fields like "name","pid","session",...
      const lines = output.trim().split(/\r?\n/)
      for (const line of lines) {
        // Extract the first quoted field (image name)
        const match = line.match(/^"([^"]*)"/)
        if (match && match[1].toLowerCase() === exeName.toLowerCase()) {
          return true
        }
      }
    } catch {
      continue
    }
  }

  return false
}

export { isGameRunning }
