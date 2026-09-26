import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e-electron',
  workers: 1,
  reporter: 'list',
  timeout: 60_000
})
