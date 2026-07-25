import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Main-process modules import `electron`, which throws outside an
      // Electron runtime. Aliasing it to a stub lets tests exercise the REAL
      // functions instead of inline copies of them — see tests/stubs/electron.js.
      electron: resolve('tests/stubs/electron.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js', 'tests/**/*.test.jsx'],
    exclude: ['node_modules/**', 'dist/**', 'out/**'],
    globals: false,
    testTimeout: 10000,
  },
})
