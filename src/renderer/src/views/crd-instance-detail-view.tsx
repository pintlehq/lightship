import { Badge } from '@renderer/ui/components/badge'
import { Card } from '@renderer/ui/components/card'
import { Dot } from '@renderer/ui/components/dot'
import { Tabs, type TabDef } from '@renderer/ui/components/tabs'
import type { Tone } from '@renderer/ui/lib/types'

import type { CustomResourceColumn, ResourceRow } from '../../../shared/ipc-types'
import { detailTabKey, resolveDetailTab } from '../lib/detail-tab-key'
import { useEvents, useResourceDetail } from '../queries/use-lightship-data'
import { useDetailTabStore } from '../stores/detail-tab-store'
import { EventList } from './event-list'
import { SideSection } from './side-section'
import { YamlEditor } from './yaml-editor'

const condTone = (status: string): Extract<Tone, 'success' | 'destructive' | 'dim'> =>
  status === 'True' ? 'success' : status === 'False' ? 'destructive' : 'dim'

const condVariant = (status: string): 'success' | 'destructive' | 'secondary' =>
  status === 'True' ? 'success' : status === 'False' ? 'destructive' : 'secondary'

const fmtDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

export function CrdInstanceDetailView({
  clusterId,
  group,
  version,
  plural,
  namespaced,
  crdKind,
  columns,
  row
}: {
  clusterId: string
  group: string
  version: string
  plural: string
  namespaced: boolean
  crdKind: string
  columns: CustomResourceColumn[]
  row: ResourceRow
}) {
  // A ref carrying the dynamic GVK (apiVersion) so the generic backend getters
  // (YAML / detail / events) can resolve this custom-resource instance.
  const objRef = {
    kind: crdKind,
    namespace: row.namespace,
    name: row.name,
    apiVersion: `${group}/${version}`
  }
  const { data: detail } = useResourceDetail(clusterId, objRef)
  const { data: events = [] } = useEvents(clusterId, objRef)
  const labels = Object.entries(detail?.labels ?? {})
  const conditions = detail?.conditions ?? []

  const tabDefs: TabDef[] = [
    { value: 'overview', label: 'Properties' },
    { value: 'yaml', label: 'YAML' },
    { value: 'events', label: 'Events', count: events.length || undefined }
  ]
  const tabKey = detailTabKey(clusterId, plural, row.namespace, row.name)
  const remembered = useDetailTabStore((s) => s.byKey[tabKey])
  const rememberTab = useDetailTabStore((s) => s.setFor)
  const tab = resolveDetailTab(
    remembered,
    tabDefs.map((t) => t.value)
  )
  const setTab = (v: string): void => rememberTab(tabKey, v)

  const created = detail?.created ? `${row.age} ago · ${fmtDate(detail.created)}` : `${row.age} ago`
  const metaRows: Array<[string, string]> = [
    ['created', created],
    ['name', row.name],
    ...(namespaced && row.namespace
      ? ([['namespace', row.namespace]] as Array<[string, string]>)
      : []),
    ['kind', crdKind],
    ['finalizers', detail?.finalizers?.length ? detail.finalizers.join(', ') : '—'],
    ...columns.map((c) => [c.header, row.columns[c.key] ?? '—'] as [string, string])
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center border-b border-border bg-chrome px-2">
        <Tabs value={tab} onChange={setTab} tabs={tabDefs} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'overview' && (
          <div className="space-y-4 p-5">
            <Card className="p-4 font-mono text-[12px]">
              <div className="mb-3 flex items-center gap-2">
                <Dot
                  tone={
                    conditions.length
                      ? condTone(conditions[conditions.length - 1].status)
                      : 'primary'
                  }
                  pulse
                />
                <span className="text-[13px] text-foreground">{row.name}</span>
              </div>
              <SideSection title="Properties" rows={metaRows} labelWidth="170px" />
              <h4 className="mb-1.5 mt-4 text-2xs font-medium uppercase tracking-[0.08em] text-dim">
                Status
              </h4>
              {conditions.length === 0 ? (
                <span className="text-dim">—</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {conditions.map((c) => (
                    <Badge key={c.type} variant={condVariant(c.status)} title={c.reason}>
                      {c.type}
                    </Badge>
                  ))}
                </div>
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
        {tab === 'yaml' && <YamlEditor clusterId={clusterId} refTarget={objRef} />}
        {tab === 'events' && (
          <div className="p-5">
            <EventList events={events.slice(0, 10)} />
          </div>
        )}
      </div>
    </div>
  )
}
