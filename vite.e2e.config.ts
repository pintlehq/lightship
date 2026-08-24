import { resolve } from 'path'
import { defineConfig, type UserConfig } from 'vite'

import electronViteConfig from './electron.vite.config'

// Serves ONLY the renderer (no Electron) so Playwright can drive the UI headlessly.
// Reuses the renderer block from electron.vite.config.ts so plugins / aliases /
// optimizeDeps stay in sync. Run via `vite --config vite.e2e.config.ts --mode e2e`,
// which flips the renderer's E2E seam (see src/renderer/src/lib/ipc.ts).
const renderer = (electronViteConfig as unknown as { renderer: UserConfig }).renderer

export default defineConfig({
  ...renderer,
  root: resolve(__dirname, 'src/renderer'),
  server: { ...renderer.server, port: 5273, strictPort: true }
})
