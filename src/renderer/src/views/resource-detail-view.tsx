import { useState } from 'react'
import { Button } from '@renderer/ui/components/button'
import { Card } from '@renderer/ui/components/card'
import { Dot } from '@renderer/ui/components/dot'
import { Icon } from '@renderer/ui/components/icon'
import { Tabs, type TabDef } from '@renderer/ui/components/tabs'

import {
  canForwardResource,
  canLogResource,
  canScaleResource
} from '../../../shared/resource-capabilities'
import { detailTabKey, resolveDetailTab } from '../lib/detail-tab-key'
import { useEvents, useResourceDetail } from '../queries/use-lightship-data'
import { RESOURCE_REGISTRY } from '../resources/registry'
import { useDetailTabStore } from '../stores/detail-tab-store'
import { useUiStore } from '../stores/ui-store'
import type { ResourceRow } from '../types'
import { ConfigDataEditor } from './config-data-editor'
import { EventList } from './event-list'
import { LogsPane } from './logs-pane'
import { PortForwardDialog } from './port-forward-dialog'
import { ScaleResourceDialog } from './scale-resource-dialog'
import { SideSection } from './side-section'
import { StatCard } from './stat-card'
import { YamlEditor } from './yaml-editor'

export function ResourceDetailView({
  clusterId,
  resourceId,
  label,
  row
}: {
  clusterId: string
  resourceId: string
  label: string
  row: ResourceRow
}) {
  const desc = RESOURCE_REGISTRY[resourceId]
  const columns = desc?.columns ?? []
  const isConfig = resourceId === 'configmaps' || resourceId === 'secrets'
  const isLoggable = canLogResource(resourceId)
  const isForwardable = canForwardResource(resourceId)
  const isScalable = canScaleResource(resourceId)
  const readOnly = useUiStore((s) => s.readOnly)
  const objRef = { kind: resourceId, namespace: row.namespace, name: row.name }
  const { data: detail } = useResourceDetail(clusterId, objRef)
  const { data: events = [] } = useEvents(clusterId, objRef)
  const labels = Object.entries(detail?.labels ?? {})
  const [forwarding, setForwarding] = useState(false)
  const [scaling, setScaling] = useState(false)

  // Sub-tabs available for this kind (Data only for ConfigMaps/Secrets, Logs
  // only for loggable workloads). Built once so the <Tabs> list and the
  // remembered-tab validation share one source of truth.
  const tabDefs: TabDef[] = [
    { value: 'overview', label: 'Overview' },
    ...(isConfig ? [{ value: 'data', label: 'Data' }] : []),
    ...(isLoggable ? [{ value: 'logs', label: 'Logs' }] : []),
    { value: 'yaml', label: 'YAML' },
    { value: 'events', label: 'Events', count: events.length || undefined }
  ]
  // Remember the active sub-tab per resource, persisted to disk via the backend.
  const tabKey = detailTabKey(clusterId, resourceId, row.namespace, row.name)
  const remembered = useDetailTabStore((s) => s.byKey[tabKey])
  const rememberTab = useDetailTabStore((s) => s.setFor)
  const tab = resolveDetailTab(
    remembered,
    tabDefs.map((t) => t.value)
  )
  const setTab = (v: string): void => rememberTab(tabKey, v)

  const metaRows: Array<[string, string]> = [
    ['name', row.name],
    ...(row.namespace ? ([['namespace', row.namespace]] as Array<[string, string]>) : []),
    ['age', row.age],
    ...columns.map((c) => [c.header.toLowerCase(), row.columns[c.key] ?? '—'] as [string, string])
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center border-b border-border bg-chrome px-2">
        <Tabs value={tab} onChange={setTab} tabs={tabDefs} />
        {(isScalable || isForwardable) && (
          <div className="ml-auto flex gap-2">
            {isScalable && (
              <Button
                variant="outline"
                size="sm"
                disabled={readOnly}
                onClick={() => setScaling(true)}
              >
                <Icon name="chevronsUpDown" className="h-3.5 w-3.5" />
                Scale
              </Button>
            )}
            {isForwardable && (
              <Button variant="outline" size="sm" onClick={() => setForwarding(true)}>
                <Icon name="arrowRight" className="h-3.5 w-3.5" />
                Forward
              </Button>
            )}
          </div>
        )}
      </div>
      {isScalable && (
        <ScaleResourceDialog
          clusterId={clusterId}
          resourceId={resourceId}
          row={row}
          open={scaling}
          readOnly={readOnly}
          onClose={() => setScaling(false)}
        />
      )}
      {isForwardable && (
        <PortForwardDialog
          clusterId={clusterId}
          open={forwarding}
          onClose={() => setForwarding(false)}
          refTarget={{ kind: resourceId, namespace: row.namespace, name: row.name }}
          name={row.name}
          ports={detail?.ports}
        />
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'overview' && (
          <div className="space-y-4 p-5">
            {columns.length > 0 ? (
              <div className="grid grid-cols-3 gap-3">
                {columns.map((c) => (
                  <StatCard key={c.key} label={c.header} value={row.columns[c.key] ?? '—'} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Name" value={row.name} />
              </div>
            )}
            <Card className="p-4 font-mono text-[12px]">
              <div className="mb-3 flex items-center gap-2">
                <Dot tone="primary" pulse />
                <span className="text-[13px] text-foreground">{label}</span>
              </div>
              <SideSection title="Metadata" rows={metaRows} />
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
        {tab === 'data' && isConfig && (
          <ConfigDataEditor
            clusterId={clusterId}
            refTarget={{ kind: resourceId, namespace: row.namespace, name: row.name }}
            secret={resourceId === 'secrets'}
          />
        )}
        {tab === 'logs' && isLoggable && (
          <LogsPane
            clusterId={clusterId}
            refs={[{ kind: resourceId, namespace: row.namespace, name: row.name }]}
          />
        )}
        {tab === 'yaml' && (
          <YamlEditor
            clusterId={clusterId}
            refTarget={{ kind: resourceId, namespace: row.namespace, name: row.name }}
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
