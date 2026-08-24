import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      },
      dedupe: ['react', 'react-dom']
    },
    plugins: [react(), tailwindcss()],
    optimizeDeps: {
      include: [
        '@base-ui/react/button',
        '@base-ui/react/checkbox',
        '@base-ui/react/context-menu',
        '@base-ui/react/dialog',
        '@base-ui/react/menu',
        '@base-ui/react/popover',
        '@base-ui/react/separator',
        '@base-ui/react/switch',
        '@base-ui/react/tooltip',
        '@tanstack/react-query',
        '@tanstack/react-table',
        '@tanstack/react-virtual',
        '@uiw/react-codemirror',
        '@uiw/codemirror-themes',
        '@codemirror/lang-yaml',
        'zustand'
      ]
    }
  }
})
