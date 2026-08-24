import { describe, it, expect, beforeEach } from 'vitest'
import { useThemeStore } from './theme-store'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  useThemeStore.getState().setTheme('system')
  useThemeStore.getState().syncSystemTheme(false)
  localStorage.clear()
})

describe('theme-store', () => {
  it('setTheme applies the .dark class and persists', () => {
    useThemeStore.getState().setTheme('dark')
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('lightship-theme')).toBe('dark')

    useThemeStore.getState().setTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('lightship-theme')).toBe('light')
  })

  it('toggle flips between light and dark', () => {
    useThemeStore.getState().setTheme('light')
    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('tracks operating-system changes only while System is selected', () => {
    useThemeStore.getState().setTheme('system')
    expect(localStorage.getItem('lightship-theme')).toBe('system')

    useThemeStore.getState().syncSystemTheme(true)
    expect(useThemeStore.getState().resolvedTheme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    useThemeStore.getState().setTheme('light')
    useThemeStore.getState().syncSystemTheme(true)
    expect(useThemeStore.getState().resolvedTheme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('toggle turns the effective System color into an explicit override', () => {
    useThemeStore.getState().setTheme('system')
    useThemeStore.getState().syncSystemTheme(true)
    useThemeStore.getState().toggle()

    expect(useThemeStore.getState().theme).toBe('light')
    expect(localStorage.getItem('lightship-theme')).toBe('light')
  })
})
