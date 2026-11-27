// One throwaway data folder for the whole run, removed when it ends. Created
// here, in the main vitest process, so every test worker inherits its path
// (setup-isolated-appdata.js points %APPDATA% / %LOCALAPPDATA% into it).
import fs from 'fs'
import os from 'os'
import path from 'path'

export default function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-test-appdata-'))
  process.env.HZMM_TEST_DATA_ROOT = root
  return () => {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 })
  }
}
