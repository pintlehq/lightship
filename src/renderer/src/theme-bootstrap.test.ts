import { afterEach, describe, expect, it, vi } from 'vitest'

function mockSystemTheme(isDark: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: isDark,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
        addListener() {},
        removeListener() {}
      }) as MediaQueryList
  )
}

async function runBootstrap(): Promise<void> {
  vi.resetModules()
  await import('./theme-bootstrap')
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  delete document.documentElement.dataset.theme
})

describe('theme bootstrap', () => {
  it('uses the operating-system color before React mounts', async () => {
    mockSystemTheme(true)
    await runBootstrap()

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('honors a saved override instead of the operating-system color', async () => {
    localStorage.setItem('lightship-theme', 'light')
    mockSystemTheme(true)
    await runBootstrap()

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
