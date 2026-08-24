import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Two Vitest projects with different needs:
//   • renderer — jsdom + React; carries over the `@renderer` alias and
//     `dedupe: ['react','react-dom']` (a single React instance, so Base UI /
//     local Base UI components don't hit "Invalid hook call") plus the jsdom setup shim.
//   • main — Node env for the main-process service layer (src/main) and the
//     shared IPC schemas (src/shared). No React, no jsdom, no setup shim.
// `vitest run` runs both; the existing `test` script needs no change.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: {
          alias: { '@renderer': resolve(__dirname, 'src/renderer/src') },
          dedupe: ['react', 'react-dom']
        },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          setupFiles: ['./src/renderer/src/test/setup.ts'],
          include: ['src/renderer/src/**/*.test.{ts,tsx}']
        }
      },
      {
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts']
        }
      }
    ]
  }
})
