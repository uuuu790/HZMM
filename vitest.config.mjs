import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js', 'tests/**/*.test.jsx'],
    exclude: ['node_modules/**', 'dist/**', 'out/**'],
    globalSetup: ['tests/global-setup.js'],
    setupFiles: ['tests/setup-isolated-appdata.js'],
    globals: false,
    testTimeout: 10000,
  },
})
