import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useThemeStore } from '@renderer/ui/stores/theme-store'
import '@xterm/xterm/css/xterm.css'

import type { TerminalHandle } from '../../../shared/ipc-types'
import { clusterApi, hasBackend } from '../lib/ipc'
import type { TerminalSessionMeta } from '../stores/terminals-store'

// Read a design token (space-separated RGB channels) as an xterm color string.
function cssColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v ? `rgb(${v})` : fallback
}

function xtermTheme(isDark: boolean) {
  return {
    background: cssColor('--background', isDark ? '#09090b' : '#ffffff'),
    foreground: cssColor('--foreground', isDark ? '#fafafa' : '#09090b'),
    cursor: cssColor('--primary', isDark ? '#fafafa' : '#18181b'),
    cursorAccent: cssColor('--background', isDark ? '#09090b' : '#ffffff'),
    selectionBackground: cssColor('--muted', isDark ? '#27272a' : '#f4f4f5')
  }
}

/** One xterm.js terminal bound to one pty session. Stays mounted while inactive
 *  (keeps its scrollback); refits when it becomes the active tab. */
export function TerminalSession({
  session,
  active
}: {
  session: TerminalSessionMeta
  active: boolean
}) {
  const isDark = useThemeStore((s) => s.resolvedTheme === 'dark')
  const ref = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const handleRef = useRef<TerminalHandle | null>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
      fontSize: 12,
      cursorBlink: true,
      theme: xtermTheme(isDark)
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(ref.current!)
    try {
      fit.fit()
    } catch {
      /* container not measurable yet */
    }
    termRef.current = term
    fitRef.current = fit

    if (hasBackend()) {
      const handle = clusterApi.openTerminal(
        session.clusterId,
        {
          cols: term.cols,
          rows: term.rows,
          namespace: session.namespace,
          pod: session.pod,
          container: session.container
        },
        (ev) => {
          if (ev.type === 'data') term.write(ev.data)
          else if (ev.type === 'exit')
            term.writeln(`\r\n\x1b[2m[process exited (${ev.exitCode})]\x1b[0m`)
          else term.writeln(`\r\n\x1b[31m${ev.message}\x1b[0m`)
        }
      )
      handleRef.current = handle
      term.onData((d) => handle.write(d))
    } else {
      term.writeln('\x1b[2mTerminal requires the desktop app (no backend in browser).\x1b[0m')
    }

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* hidden */
      }
      handleRef.current?.resize(term.cols, term.rows)
    })
    if (ref.current) ro.observe(ref.current)

    return () => {
      ro.disconnect()
      handleRef.current?.kill()
      term.dispose()
    }
    // Create once per mounted session; theme/active handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme(isDark)
  }, [isDark])

  // A hidden terminal can't measure; refit + refocus when it becomes active.
  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
      } catch {
        /* not measurable */
      }
      const term = termRef.current
      if (term) {
        handleRef.current?.resize(term.cols, term.rows)
        term.focus()
      }
    })
  }, [active])

  return <div ref={ref} className="h-full w-full p-2" />
}
