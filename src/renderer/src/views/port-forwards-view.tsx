import { Button } from '@renderer/ui/components/button'
import { Card } from '@renderer/ui/components/card'
import { Dot } from '@renderer/ui/components/dot'
import { Icon } from '@renderer/ui/components/icon'
import type { Tone } from '@renderer/ui/lib/types'

import { usePortForwardsStore, type PortForwardStatus } from '../stores/port-forwards-store'
import { ViewHeader } from './view-header'

const STATUS_TONE: Record<PortForwardStatus, Tone> = {
  starting: 'dim',
  running: 'success',
  error: 'destructive',
  closed: 'warning'
}

export function PortForwardsView() {
  const sessions = usePortForwardsStore((s) => s.sessions)
  const stop = usePortForwardsStore((s) => s.stop)

  return (
    <div className="p-5">
      <ViewHeader
        crumbs={['cluster', 'network']}
        title="Port forwards"
        meta={<span>{sessions.length} active</span>}
      />

      <Card className="overflow-hidden">
        {sessions.length === 0 ? (
          <div className="grid h-40 place-items-center">
            <div className="flex flex-col items-center gap-2.5 text-center font-mono text-[12.5px] text-dim">
              <Icon name="arrowRight" className="h-10 w-10 text-faint" />
              <span>No active port forwards — open a Pod or Service and click Forward</span>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border/60 font-mono text-[12.5px]">
            {sessions.map((s) => {
              const url = `http://localhost:${s.localPort}`
              return (
                <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Dot tone={STATUS_TONE[s.status]} pulse={s.status === 'running'} />
                  <div className="min-w-0">
                    <div className="truncate text-foreground">{s.name}</div>
                    <div className="text-[11px] text-faint">
                      {s.kind}
                      {s.ref.namespace ? ` · ${s.ref.namespace}` : ''}
                    </div>
                  </div>
                  <div className="ml-auto text-muted-foreground">
                    {s.status === 'running' ? (
                      <>
                        localhost:{s.localPort} <span className="text-faint">→ {s.remotePort}</span>
                      </>
                    ) : s.status === 'error' ? (
                      <span className="text-destructive" title={s.error}>
                        {s.error ?? 'error'}
                      </span>
                    ) : (
                      <span className="text-dim">{s.status}…</span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={s.status !== 'running'}
                      onClick={() => void window.api?.window?.openExternal(url)}
                    >
                      <Icon name="link" className="h-3.5 w-3.5" />
                      Open
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => stop(s.id)}>
                      <Icon name="x" className="h-3.5 w-3.5" />
                      Stop
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
