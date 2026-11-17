import { defineConfig } from '@playwright/test'

// The app starts its own backend, and a single worker prevents concurrent app instances.
export default defineConfig({
  testDir: './e2e/app',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
})
