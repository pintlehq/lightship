/** Applies the saved Lightship preference before React mounts to prevent a flash. */
try {
  const stored = localStorage.getItem('lightship-theme')
  const preference =
    stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document.documentElement.dataset.theme = resolved
} catch {
  document.documentElement.classList.remove('dark')
  document.documentElement.dataset.theme = 'light'
}

export {}
