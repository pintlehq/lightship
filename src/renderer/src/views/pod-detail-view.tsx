import { Fragment, useState } from 'react'
import { Button } from '@renderer/ui/components/button'
import { Card } from '@renderer/ui/components/card'
import { Dot } from '@renderer/ui/components/dot'
import { Icon } from '@renderer/ui/components/icon'
import { Tabs, type TabDef } from '@renderer/ui/components/tabs'
import { cn } from '@renderer/ui/lib/utils'
import { TONE_TEXT } from '@renderer/ui/lib/tones'

import { POD_STATUS } from '../data/static'
import { detailTabKey, resolveDetailTab } from '../lib/detail-tab-key'
import { useEvents, useResourceDetail } from '../queries/use-lightship-data'
import { useDetailTabStore } from '../stores/detail-tab-store'
import type { Pod } from '../types'
import { EventList } from './event-list'
import { PortForwardDialog } from './port-forward-dialog'
import { StatCard } from './stat-card'
import { YamlEditor } from './yaml-editor'
import { LogsPane } from './logs-pane'

function SideSection({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <>
      <h4 className="mb-1.5 mt-4 text-2xs font-medium uppercase tracking-[0.08em] text-dim first:mt-0">
        {title}
      </h4>
      <dl className="grid grid-cols-[100px_1fr] gap-x-2.5 gap-y-1">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-dim">{k}</dt>
            <dd className="m-0 break-all text-foreground">{v}</dd>
          </Fragment>
        ))}
      </dl>
    </>
  )
}

export function PodDetailView({ clusterId, pod }: { clusterId: string; pod: Pod }) {
  const tone = POD_STATUS[pod.status] ?? 'dim'
  const podRef = { kind: 'pods', namespace: pod.ns, name: pod.name }
  const { data: detail } = useResourceDetail(clusterId, podRef)
  const { data: events = [] } = useEvents(clusterId, podRef)
  const containers = detail?.containers ?? []
  const labels = Object.entries(detail?.labels ?? {})
  const [forwarding, setForwarding] = useState(false)

  const tabDefs: TabDef[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'yaml', label: 'YAML' },
    { value: 'logs', label: 'Logs' },
    { value: 'events', label: 'Events', count: events.length || undefined }
  ]
  // Remember the active sub-tab per pod, persisted to disk via the backend.
  const tabKey = detailTabKey(clusterId, 'pods', pod.ns, pod.name)
  const remembered = useDetailTabStore((s) => s.byKey[tabKey])
  const rememberTab = useDetailTabStore((s) => s.setFor)
  const tab = resolveDetailTab(
    remembered,
    tabDefs.map((t) => t.value)
  )
  const setTab = (v: string): void => rememberTab(tabKey, v)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center border-b border-border bg-chrome px-2">
        <Tabs value={tab} onChange={setTab} tabs={tabDefs} />
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setForwarding(true)}>
          <Icon name="arrowRight" className="h-3.5 w-3.5" />
          Forward
        </Button>
      </div>
      <PortForwardDialog
        clusterId={clusterId}
        open={forwarding}
        onClose={() => setForwarding(false)}
        refTarget={{ kind: 'pods', namespace: pod.ns, name: pod.name }}
        name={pod.name}
        ports={detail?.ports}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'overview' && (
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-3 gap-3">
              <StatCard
                label="CPU"
                value={pod.cpu}
                sub={detail?.cpuLimit ? `limit ${detail.cpuLimit}` : 'no limit'}
              />
              <StatCard
                label="Memory"
                value={pod.mem}
                sub={detail?.memLimit ? `limit ${detail.memLimit}` : 'no limit'}
              />
              <StatCard
                label="Restarts"
                value={pod.restarts}
                sub={pod.restarts > 0 ? 'restarted' : 'stable'}
                subTone={pod.restarts > 0 ? 'up' : 'down'}
              />
            </div>
            <Card className="p-4">
              <h3 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-dim">
                Containers
              </h3>
              {containers.length === 0 ? (
                <span className="font-mono text-[12.5px] text-dim">No containers</span>
              ) : (
                containers.map((c) => {
                  const ok = c.ready && c.state === 'Running'
                  const cTone = ok ? 'success' : c.state === 'Running' ? 'warning' : 'destructive'
                  return (
                    <div
                      key={c.name}
                      className="flex items-center gap-3 border-b border-border/60 py-2 font-mono text-[12.5px] last:border-0"
                    >
                      <Icon name="box" className="h-3.5 w-3.5 text-primary" />
                      <span className="text-foreground">{c.name}</span>
                      {c.restarts > 0 && (
                        <span className="text-faint">· {c.restarts} restarts</span>
                      )}
                      <span
                        className={cn('ml-auto inline-flex items-center gap-1.5', TONE_TEXT[cTone])}
                      >
                        <Dot tone={cTone} pulse={ok} />
                        {c.state}
                      </span>
                    </div>
                  )
                })
              )}
            </Card>
            <Card className="p-4 font-mono text-[12px]">
              <div className="mb-3 flex items-center gap-2">
                <Dot tone={tone} pulse />
                <span className={cn('text-[13px]', TONE_TEXT[tone])}>{pod.status}</span>
              </div>
              <SideSection
                title="Metadata"
                rows={[
                  ['name', pod.name],
                  ['namespace', pod.ns],
                  ['node', pod.node],
                  ['pod IP', pod.ip],
                  ['age', pod.age]
                ]}
              />
              <SideSection
                title="QoS"
                rows={[
                  ['class', detail?.qosClass ?? '—'],
                  ['ready', pod.ready],
                  ['restarts', String(pod.restarts)]
                ]}
              />
              {detail?.ports && detail.ports.length > 0 && (
                <>
                  <h4 className="mb-1.5 mt-4 text-2xs font-medium uppercase tracking-[0.08em] text-dim">
                    Ports
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {detail.ports.map((p) => (
                      <span
                        key={`${p.name ?? ''}-${p.port}`}
                        className="inline-flex items-center gap-1 rounded border border-border/70 bg-background px-1.5 py-px text-2xs"
                      >
                        {p.name && <span className="text-info">{p.name}</span>}
                        <span className="text-foreground">{p.port}</span>
                        {p.protocol && p.protocol !== 'TCP' && (
                          <span className="text-faint">/{p.protocol}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </>
              )}
              <h4 className="mb-1.5 mt-4 text-2xs font-medium uppercase tracking-[0.08em] text-dim">
                Labels
              </h4>
              {labels.length === 0 ? (
                <span className="text-dim">No labels</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {labels.map(([k, v]) => (
                    <span
                      key={k}
                      className="inline-flex items-center rounded border border-border/70 bg-background px-1.5 py-px text-2xs"
                    >
                      <span className="text-info">{k}</span>
                      <span className="text-faint">=</span>
                      <span className="text-foreground">{v}</span>
                    </span>
                  ))}
                </div>
              )}
            </Card>
            <Card className="p-4">
              <h3 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-dim">
                Recent events
              </h3>
              <EventList events={events.slice(0, 10)} />
            </Card>
          </div>
        )}
        {tab === 'yaml' && (
          <YamlEditor
            clusterId={clusterId}
            refTarget={{ kind: 'pods', namespace: pod.ns, name: pod.name }}
          />
        )}
        {tab === 'logs' && (
          <LogsPane
            clusterId={clusterId}
            refs={[{ kind: 'pods', namespace: pod.ns, name: pod.name }]}
          />
        )}
        {tab === 'events' && (
          <div className="p-5">
            <EventList events={events.slice(0, 10)} />
          </div>
        )}
      </div>
    </div>
  )
}
