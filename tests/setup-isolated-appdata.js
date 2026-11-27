// Runs before every test file. The main-process modules resolve their data
// folder from %APPDATA% (config-store, and the logger through it) and the
// game's save folder from %LOCALAPPDATA% — a test that imports one of them
// without mocking would otherwise write into the real HZMM log or config on
// the machine running the tests. Point both into the run's throwaway folder
// (made and removed by global-setup.js), one subfolder per test file.
import fs from 'fs'
import os from 'os'
import path from 'path'

const root = process.env.HZMM_TEST_DATA_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-test-appdata-'))
const own = fs.mkdtempSync(path.join(root, 'file-'))
process.env.APPDATA = path.join(own, 'Roaming')
process.env.LOCALAPPDATA = path.join(own, 'Local')
fs.mkdirSync(process.env.APPDATA, { recursive: true })
fs.mkdirSync(process.env.LOCALAPPDATA, { recursive: true })
