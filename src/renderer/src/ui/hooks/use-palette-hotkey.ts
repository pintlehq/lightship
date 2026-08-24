import { useEffect } from 'react'

/** Binds ⌘K / Ctrl+K to the supplied toggle callback. */
export function usePaletteHotkey(toggle: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggle])
}
