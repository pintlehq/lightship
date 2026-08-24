import { defineConfig, devices } from '@playwright/test'

const PORT = 5273
const BASE_URL = `http://localhost:${PORT}`

// E2E runs against the renderer served by Vite in `e2e` mode (no Electron). The
// mode flips the cluster-list mock seam so the whole UI is reachable with the
// existing renderer mock data. See vite.e2e.config.ts and src/renderer/src/lib/ipc.ts.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite --config vite.e2e.config.ts --mode e2e',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
})
