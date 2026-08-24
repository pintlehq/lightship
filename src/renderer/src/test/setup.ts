import '@testing-library/jest-dom/vitest' // augments expect(...).toBeInTheDocument() etc.
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom lacks these; TanStack Virtual / Base UI primitives touch them at render time.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false
    },
    addListener() {},
    removeListener() {}
  })) as unknown as typeof window.matchMedia
}

afterEach(() => cleanup())
