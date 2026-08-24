import { useEffect, useRef } from 'react'
import { Icon } from '@renderer/ui/components/icon'
import { Button } from '@renderer/ui/components/button'
import { Tabbar } from '@renderer/ui/shell/tabbar'
import { cn } from '@renderer/ui/lib/utils'

import type { ClusterMeta } from '../../../shared/ipc-types'
import { useTerminalsStore } from '../stores/terminals-store'
import { useUiStore } from '../stores/ui-store'
import { TerminalSession } from './terminal-session'

const MIN_H = 140
const maxH = (): number => Math.round(window.innerHeight * 0.85)

export function TerminalPanel({
  activeCluster,
  onClose
}: {
  activeCluster?: ClusterMeta
  onClose: () => void
}) {
  const sessions = useTerminalsStore((s) => s.sessions)
  const activeId = useTerminalsStore((s) => s.activeId)
  const setActive = useTerminalsStore((s) => s.setActive)
  const closeSession = useTerminalsStore((s) => s.closeSession)
  const closeOthers = useTerminalsStore((s) => s.closeOthers)
  const closeToRight = useTerminalsStore((s) => s.closeToRight)
  const closeAll = useTerminalsStore((s) => s.closeAll)
  const reorderSessions = useTerminalsStore((s) => s.reorderSessions)
  const newSession = useTerminalsStore((s) => s.newSession)
  const setFocused = useTerminalsStore((s) => s.setFocused)

  const height = useUiStore((s) => s.terminalHeight)
  const setHeight = useUiStore((s) => s.setTerminalHeight)
  const drag = useRef<{ startY: number; startHeight: number } | null>(null)

  // Clear the panel-focus flag when the panel unmounts (closed).
  useEffect(() => () => setFocused(false), [setFocused])

  const onHandleDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startY: e.clientY, startHeight: height }
  }
  const onHandleMove = (e: React.PointerEvent): void => {
    if (!drag.current) return
    const next = drag.current.startHeight - (e.clientY - drag.current.startY)
    setHeight(Math.max(MIN_H, Math.min(maxH(), next)))
  }
  const onHandleUp = (e: React.PointerEvent): void => {
    drag.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const startForActive = activeCluster
    ? () => newSession({ clusterId: activeCluster.id, clusterName: activeCluster.name })
    : undefined

  return (
    <div
      className="relative flex flex-col border-t border-border bg-background"
      style={{ height }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      <div
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
        className="absolute inset-x-0 top-0 z-10 h-1 -translate-y-1/2 cursor-row-resize hover:bg-primary/40"
      />

      <Tabbar
        variant="panel"
        tabs={sessions.map((s) => ({ id: s.id, label: s.title ?? s.clusterName }))}
        activeId={activeId}
        onSelect={setActive}
        onClose={closeSession}
        onCloseOthers={closeOthers}
        onCloseToRight={closeToRight}
        onCloseAll={closeAll}
        onReorder={reorderSessions}
        onNew={startForActive}
        actions={[{ icon: 'x', label: 'Close panel', onClick: onClose }]}
      />

      <div className="relative min-h-0 flex-1 bg-background">
        {sessions.length === 0 ? (
          <div className="grid h-full place-items-center gap-3 text-center font-mono text-[12.5px] text-dim">
            <Icon name="terminal" className="mx-auto h-7 w-7 text-faint" />
            <p>Right-click a cluster → New terminal, or start one here.</p>
            {activeCluster && (
              <Button size="sm" onClick={startForActive}>
                <Icon name="plus" className="h-3 w-3" />
                New terminal · {activeCluster.name}
              </Button>
            )}
          </div>
        ) : (
          sessions.map((t) => (
            <div
              key={t.id}
              className={cn('absolute inset-0', t.id === activeId ? 'block' : 'hidden')}
            >
              <TerminalSession session={t} active={t.id === activeId} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
