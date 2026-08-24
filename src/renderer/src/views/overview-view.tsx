import { useEffect, useState } from 'react'
import { Card } from '@renderer/ui/components/card'
import { Dot } from '@renderer/ui/components/dot'

import { useOverviewBundle } from '../queries/use-lightship-data'
import { eventTone } from '../lib/event-tone'
import { Sparkline } from './sparkline'
import { ViewHeader } from './view-header'
import { StatCard } from './stat-card'

const MAX_POINTS = 40

function TrendCard({
  label,
  pct,
  history,
  color
}: {
  label: string
  pct: number | null | undefined
  history: number[]
  color: 'primary' | 'warning'
}) {
  return (
    <Card className="flex flex-col p-4">
      <h3 className="mb-1 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-dim">
        {label}
      </h3>
      <div className="font-mono text-[26px] font-medium leading-none tabular-nums text-foreground">
        {pct == null ? '—' : pct}
        {pct != null && <span className="ml-1 text-sm text-dim">%</span>}
      </div>
      <div className="mt-3 h-20">
        {pct == null ? (
          <div className="grid h-full place-items-center font-mono text-[11px] text-faint">
            metrics-server n/a
          </div>
        ) : (
          <Sparkline data={history} color={color} />
        )}
      </div>
    </Card>
  )
}

export function OverviewView({ clusterId }: { clusterId: string }) {
  const { data: bundle, dataUpdatedAt } = useOverviewBundle(clusterId)
  const ov = bundle?.overview
  const events = bundle?.events ?? []
  const [cpuHist, setCpuHist] = useState<number[]>([])
  const [memHist, setMemHist] = useState<number[]>([])

  // Accumulate a rolling window of metrics on each successful poll.
  useEffect(() => {
    if (!ov) return
    if (ov.cpuPct != null) setCpuHist((h) => [...h, ov.cpuPct!].slice(-MAX_POINTS))
    if (ov.memPct != null) setMemHist((h) => [...h, ov.memPct!].slice(-MAX_POINTS))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUpdatedAt])

  return (
    <div className="p-5">
      <ViewHeader crumbs={['cluster']} title="Overview" live />
      <div className="grid grid-cols-4 gap-3">
        <StatCard
          label="Nodes"
          value={ov ? ov.nodes : '—'}
          sub={
            ov
              ? ov.nodesReady === ov.nodes
                ? 'all ready'
                : `${ov.nodes - ov.nodesReady} not ready`
              : ''
          }
          subTone={ov && ov.nodesReady < ov.nodes ? 'up' : 'down'}
          bar={ov && ov.nodes ? Math.round((ov.nodesReady / ov.nodes) * 100) : undefined}
        />
        <StatCard
          label="Pods"
          value={ov ? ov.pods : '—'}
          unit={ov ? `/ ${ov.podsCapacity}` : undefined}
          sub={ov ? `${ov.namespaces} namespaces` : ''}
          bar={ov && ov.podsCapacity ? Math.round((ov.pods / ov.podsCapacity) * 100) : undefined}
          barTone="warning"
        />
        <StatCard
          label="CPU"
          value={ov?.cpuPct ?? '—'}
          unit={ov?.cpuPct != null ? '%' : undefined}
          sub={ov && ov.cpuPct == null ? 'metrics-server n/a' : ''}
          bar={ov?.cpuPct ?? undefined}
        />
        <StatCard
          label="Memory"
          value={ov?.memPct ?? '—'}
          unit={ov?.memPct != null ? '%' : undefined}
          sub={ov && ov.memPct == null ? 'metrics-server n/a' : ''}
          bar={ov?.memPct ?? undefined}
          barTone="warning"
        />
        <StatCard
          label="CPU requests"
          value={ov ? ov.cpuReqPct : '—'}
          unit={ov ? '%' : undefined}
          sub={ov ? `${ov.cpuRequest} cores` : ''}
          bar={ov?.cpuReqPct}
          barTone={ov && ov.cpuReqPct >= 80 ? 'warning' : undefined}
        />
        <StatCard
          label="Memory requests"
          value={ov ? ov.memReqPct : '—'}
          unit={ov ? '%' : undefined}
          sub={ov?.memRequest}
          bar={ov?.memReqPct}
          barTone={ov && ov.memReqPct >= 80 ? 'warning' : undefined}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <TrendCard label="CPU usage" pct={ov?.cpuPct} history={cpuHist} color="primary" />
        <TrendCard label="Memory usage" pct={ov?.memPct} history={memHist} color="warning" />
      </div>
      <Card className="mt-3 p-4">
        <h3 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-dim">
          Recent events
        </h3>
        {events.length === 0 ? (
          <div className="py-4 text-center font-mono text-[11.5px] text-dim">No recent events</div>
        ) : (
          <div className="space-y-px">
            {events.slice(0, 10).map((e, i) => (
              <div
                key={i}
                className="grid grid-cols-[14px_1fr_64px] items-baseline gap-2 border-b border-border/60 py-1 font-mono text-[11.5px] last:border-0"
              >
                <Dot tone={eventTone(e)} className="mt-1" />
                <div className="min-w-0">
                  <span className="text-foreground">{e.reason}</span>{' '}
                  <span className="text-dim">{e.message}</span>
                </div>
                <span className="text-right text-faint">{e.age}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
