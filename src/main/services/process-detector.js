import { execSync } from 'child_process'
import path from 'path'

const KNOWN_EXE_NAMES = [
  'HumanitZ-Win64-Shipping.exe',
  'HumanitZ.exe'
]

function isGameRunning(gameExePath) {
  const exeNames = [...KNOWN_EXE_NAMES]
  if (gameExePath) {
    const exeName = path.basename(gameExePath)
    if (!exeNames.includes(exeName)) {
      exeNames.unshift(exeName)
    }
  }

  for (const exeName of exeNames) {
    try {
      const output = execSync(
        `tasklist /FI "IMAGENAME eq ${exeName}" /NH`,
        { encoding: 'utf-8', windowsHide: true, timeout: 3000 }
      )
      if (output.includes(exeName)) {
        return true
      }
    } catch {
      continue
    }
  }

  return false
}

export { isGameRunning }
