import { create } from 'zustand'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const THEME_KEY = 'lightship-theme'

interface ThemeState {
  theme: ThemePreference
  resolvedTheme: ResolvedTheme
  setTheme: (theme: ThemePreference) => void
  toggle: () => void
  syncSystemTheme: (isDark?: boolean) => void
}

function systemIsDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

function resolveTheme(theme: ThemePreference, isSystemDark = systemIsDark()): ResolvedTheme {
  if (theme === 'system') return isSystemDark ? 'dark' : 'light'
  return theme
}

function applyResolvedTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.dataset.theme = theme
}

function persistTheme(theme: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Persistence is best-effort in restricted renderer environments.
  }
}

function readInitialTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'system' || stored === 'light' || stored === 'dark') return stored
  } catch {
    // Fall through to the system preference.
  }
  return 'system'
}

const initialTheme = readInitialTheme()
const initialResolvedTheme = resolveTheme(initialTheme)
applyResolvedTheme(initialResolvedTheme)

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initialTheme,
  resolvedTheme: initialResolvedTheme,
  setTheme: (theme) => {
    const resolvedTheme = resolveTheme(theme)
    applyResolvedTheme(resolvedTheme)
    persistTheme(theme)
    set({ theme, resolvedTheme })
  },
  toggle: () => {
    const next: ResolvedTheme = get().resolvedTheme === 'dark' ? 'light' : 'dark'
    get().setTheme(next)
  },
  syncSystemTheme: (isDark = systemIsDark()) => {
    if (get().theme !== 'system') return
    const resolvedTheme: ResolvedTheme = isDark ? 'dark' : 'light'
    applyResolvedTheme(resolvedTheme)
    set({ resolvedTheme })
  }
}))

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', (event) =>
    useThemeStore.getState().syncSystemTheme(event.matches)
  )
}
