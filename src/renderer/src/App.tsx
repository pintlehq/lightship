import { useEffect, useState } from 'react'
import { Button } from '@renderer/components/ui/button'

function App(): React.JSX.Element {
  const [signalSent, setSignalSent] = useState(false)

  useEffect(() => {
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')

    const syncTheme = (event?: MediaQueryListEvent): void => {
      document.documentElement.classList.toggle('dark', event?.matches ?? colorScheme.matches)
    }

    syncTheme()
    colorScheme.addEventListener('change', syncTheme)

    return (): void => colorScheme.removeEventListener('change', syncTheme)
  }, [])

  const ipcHandle = (): void => {
    window.electron.ipcRenderer.send('ping')
    setSignalSent(true)
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
      <section className="flex max-w-sm flex-col items-center text-center">
        <p className="text-xs font-medium text-muted-foreground">shadcn/ui + Tailwind CSS 4</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Lightship is ready.</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This simple screen uses the generated Base UI button and the existing Electron IPC bridge.
        </p>

        <Button className="mt-6" onClick={ipcHandle}>
          {signalSent ? 'Ping sent' : 'Send IPC ping'}
        </Button>

        <p className="mt-3 min-h-4 text-xs text-muted-foreground" aria-live="polite">
          {signalSent ? 'The main process received the signal.' : ''}
        </p>
      </section>
    </main>
  )
}

export default App
