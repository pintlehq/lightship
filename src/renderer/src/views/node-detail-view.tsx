import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Badge } from '@renderer/ui/components/badge'
import { Card } from '@renderer/ui/components/card'
import { DataTable } from '@renderer/ui/components/data-table'
import { Dot } from '@renderer/ui/components/dot'
import { Icon } from '@renderer/ui/components/icon'
import { Tabs, type TabDef } from '@renderer/ui/components/tabs'
import { cn } from '@renderer/ui/lib/utils'
import { TONE_TEXT } from '@renderer/ui/lib/tones'

import { podColumns } from '../columns/pod-columns'
import { NODE_STATUS } from '../data/static'
import { detailTabKey, resolveDetailTab } from '../lib/detail-tab-key'
import { useEvents, useNodeDetail, usePods } from '../queries/use-lightship-data'
import { useDetailTabStore } from '../stores/detail-tab-store'
import type { NodeRow } from '../types'
import type {
  NodeAllocatedResource,
  NodeResourceValue,
  Pod,
  ResourceCondition
} from '../../../shared/ipc-types'
import { EventList } from './event-list'
import { Sparkline } from './sparkline'
import { StatCard } from './stat-card'

const HEADER_CELL =
  'text-left font-medium text-2xs uppercase tracking-[0.06em] text-dim px-2.5 py-2 bg-muted border-b border-border whitespace-nowrap'
const BODY_CELL = 'px-2.5 py-2 border-b border-border/50'
const MAX_SAMPLES = 40

const fmtDate = (iso: string): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

const podId = (p: Pod): string => `${p.ns}/${p.name}`

// A node's Ready condition is good when True; every other condition is shown as a
// neutral chip (its meaning — pressure vs. capability — varies by type).
function condVariant(c: ResourceCondition): 'success' | 'destructive' | 'secondary' {
  if (c.type === 'Ready') return c.status === 'True' ? 'success' : 'destructive'
  return 'secondary'
}

function PropRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-dim">{label}</dt>
      <dd className="m-0 break-all text-foreground">{children}</dd>
    </>
  )
}

function BadgeList({ entries }: { entries: Array<[string, string]> }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <span
          key={k}
          className="inline-flex items-center rounded border border-border/70 bg-background px-1.5 py-px text-2xs"
        >
          <span className="text-info">{k}</span>
          {v && (
            <>
              <span className="text-faint">=</span>
              <span className="text-foreground">{v}</span>
            </>
          )}
        </span>
      ))}
    </div>
  )
}

function ResourceValueTable({ title, rows }: { title: string; rows: NodeResourceValue[] }) {
  if (rows.length === 0) return null
  return (
    <Card className="overflow-hidden font-mono text-[12px]">
      <div className="border-b border-border px-4 py-3">
        <h4 className="text-[13px] font-semibold text-foreground">{title}</h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed">
          <thead>
            <tr>
              {rows.map((row) => (
                <th key={row.resource} className={HEADER_CELL}>
                  {row.resource}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {rows.map((row) => (
                <td key={row.resource} className={`${BODY_CELL} tabular-nums text-foreground`}>
                  {row.value}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function ResourceUsageValue({ value, pct }: { value: string; pct: number | null }) {
  return (
    <span className="inline-flex items-baseline gap-1 tabular-nums">
      <span>{value}</span>
      {pct !== null && <span className="text-dim">({pct}%)</span>}
    </span>
  )
}

function AllocatedResourcesTable({ rows }: { rows: NodeAllocatedResource[] }) {
  if (rows.length === 0) return null
  return (
    <Card className="overflow-hidden font-mono text-[12px]">
      <div className="border-b border-border px-4 py-3">
        <h4 className="text-[13px] font-semibold text-foreground">Allocated Resources</h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr>
              <th className={HEADER_CELL}>Resource</th>
              <th className={HEADER_CELL}>Requests</th>
              <th className={HEADER_CELL}>Limits</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.resource}>
                <th className={`${BODY_CELL} text-left font-medium text-foreground`}>
                  {row.resource}
                </th>
                <td className={BODY_CELL}>
                  <ResourceUsageValue value={row.requests} pct={row.requestsPct} />
                </td>
                <td className={BODY_CELL}>
                  <ResourceUsageValue value={row.limits} pct={row.limitsPct} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/** A "N Labels" count that expands to the full key=value badge list when clicked. */
function ExpandableMap({ label, map }: { label: string; map: Record<string, string> }) {
  const [open, setOpen] = useState(false)
  const entries = Object.entries(map)
  if (entries.length === 0) return <span className="text-dim">No {label.toLowerCase()}</span>
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-foreground hover:text-primary"
      >
        {entries.length} {label}
        <Icon name={open ? 'chevronDown' : 'chevronRight'} className="h-3 w-3" />
      </button>
      {open && <BadgeList entries={entries} />}
    </div>
  )
}

export function NodeDetailView({ clusterId, node }: { clusterId: string; node: NodeRow }) {
  const { data: detail } = useNodeDetail(clusterId, node.name)
  const { data: events = [] } = useEvents(clusterId, { kind: 'nodes', name: node.name })
  const { data: pods = [] } = usePods(clusterId)
  const podsOnNode = useMemo(() => pods.filter((p) => p.node === node.name), [pods, node.name])

  const tone = NODE_STATUS[node.status] ?? 'dim'
  const cpuPct = detail?.cpuPct ?? node.cpuPct
  const memPct = detail?.memPct ?? node.memPct

  // Charts: accumulate point-in-time usage into a session-only ring buffer (no
  // metrics-history backend) — samples build up at the 15s node-detail poll cadence.
  const [cpuHist, setCpuHist] = useState<number[]>([])
  const [memHist, setMemHist] = useState<number[]>([])
  useEffect(() => {
    if (!detail) return
    setCpuHist((h) => [...h, detail.cpuPct].slice(-MAX_SAMPLES))
    setMemHist((h) => [...h, detail.memPct].slice(-MAX_SAMPLES))
  }, [detail])

  const tabDefs: TabDef[] = [
    { value: 'overview', label: 'Properties' },
    { value: 'pods', label: 'Pods', count: podsOnNode.length || undefined },
    { value: 'charts', label: 'Charts', icon: 'activity' },
    { value: 'events', label: 'Events', count: events.length || undefined }
  ]
  const tabKey = detailTabKey(clusterId, 'nodes', undefined, node.name)
  const remembered = useDetailTabStore((s) => s.byKey[tabKey])
  const rememberTab = useDetailTabStore((s) => s.setFor)
  const tab = resolveDetailTab(
    remembered,
    tabDefs.map((t) => t.value)
  )
  const setTab = (v: string): void => rememberTab(tabKey, v)

  const podTableColumns = useMemo(() => podColumns, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center border-b border-border bg-chrome px-2">
        <Tabs value={tab} onChange={setTab} tabs={tabDefs} />
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'overview' && (
          <div className="h-full space-y-4 overflow-auto p-5">
            <div className="grid grid-cols-3 gap-3">
              <StatCard
                label="CPU"
                value={cpuPct}
                unit="%"
                bar={cpuPct}
                barTone={cpuPct >= 85 ? 'destructive' : cpuPct >= 70 ? 'warning' : undefined}
                sub={detail?.cpu}
              />
              <StatCard
                label="Memory"
                value={memPct}
                unit="%"
                bar={memPct}
                barTone={memPct >= 85 ? 'destructive' : memPct >= 70 ? 'warning' : undefined}
                sub={detail?.mem}
              />
              <StatCard label="Pods" value={podsOnNode.length} sub={`max ${node.maxPods}`} />
              <StatCard
                label="CPU requests"
                value={detail ? detail.cpuReqPct : '—'}
                unit={detail ? '%' : undefined}
                bar={detail?.cpuReqPct}
                barTone={detail && detail.cpuReqPct >= 80 ? 'warning' : undefined}
                sub={detail?.cpuRequest}
              />
              <StatCard
                label="Memory requests"
                value={detail ? detail.memReqPct : '—'}
                unit={detail ? '%' : undefined}
                bar={detail?.memReqPct}
                barTone={detail && detail.memReqPct >= 80 ? 'warning' : undefined}
                sub={detail?.memRequest}
              />
            </div>

            <Card className="p-4 font-mono text-[12px]">
              <div className="mb-3 flex items-center gap-2">
                <Dot tone={tone} pulse={node.status === 'Ready'} />
                <span className={cn('text-[13px]', TONE_TEXT[tone])}>{node.status}</span>
                {node.cordoned && <Badge variant="warning">cordoned</Badge>}
              </div>
              <h4 className="mb-1.5 text-2xs font-medium uppercase tracking-[0.08em] text-dim">
                Properties
              </h4>
              <dl className="grid grid-cols-[150px_1fr] gap-x-2.5 gap-y-2">
                <PropRow label="Created">
                  {detail ? `${node.age} ago · ${fmtDate(detail.created)}` : `${node.age} ago`}
                </PropRow>
                <PropRow label="Name">{node.name}</PropRow>
                <PropRow label="Roles">{(detail?.roles ?? node.roles).join(', ') || '—'}</PropRow>
                <PropRow label="Labels">
                  <ExpandableMap label="Labels" map={detail?.labels ?? {}} />
                </PropRow>
                <PropRow label="Annotations">
                  <ExpandableMap label="Annotations" map={detail?.annotations ?? {}} />
                </PropRow>
                <PropRow label="Addresses">
                  {detail && detail.addresses.length
                    ? detail.addresses.map((a) => `${a.type}: ${a.address}`).join('  ')
                    : node.ip || '—'}
                </PropRow>
                <PropRow label="OS">
                  {detail ? `${detail.os}${detail.arch ? ` (${detail.arch})` : ''}` : '—'}
                </PropRow>
                <PropRow label="OS Image">{detail?.osImage || '—'}</PropRow>
                <PropRow label="Kernel version">{detail?.kernelVersion || '—'}</PropRow>
                <PropRow label="Container runtime">{detail?.containerRuntime || '—'}</PropRow>
                <PropRow label="Kubelet version">{detail?.kubeletVersion ?? node.ver}</PropRow>
                <PropRow label="Zone">{detail?.zone || node.zone || '—'}</PropRow>
                <PropRow label="Instance type">{detail?.instanceType || node.type || '—'}</PropRow>
                <PropRow label="Conditions">
                  {detail && detail.conditions.length ? (
                    <div className="flex flex-wrap gap-1">
                      {detail.conditions.map((c) => (
                        <Badge key={c.type} variant={condVariant(c)} title={c.reason}>
                          {c.type}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    '—'
                  )}
                </PropRow>
              </dl>
            </Card>

            {detail && (
              <>
                <ResourceValueTable title="Capacity" rows={detail.capacity} />
                <ResourceValueTable title="Allocatable" rows={detail.allocatable} />
                <AllocatedResourcesTable rows={detail.allocated} />
              </>
            )}
          </div>
        )}

        {tab === 'pods' && (
          <div className="h-full p-3">
            <Card className="h-full overflow-hidden">
              {podsOnNode.length === 0 ? (
                <div className="grid h-full place-items-center font-mono text-[12.5px] text-dim">
                  No pods scheduled on this node
                </div>
              ) : (
                <DataTable
                  data={podsOnNode}
                  columns={podTableColumns}
                  getRowId={podId}
                  virtualize
                  estimateRowHeight={33}
                  stickyHeader
                  containerClassName="h-full"
                  className="font-mono text-[13px]"
                  headerCellClassName={HEADER_CELL}
                  cellClassName={BODY_CELL}
                />
              )}
            </Card>
          </div>
        )}

        {tab === 'charts' && (
          <div className="h-full overflow-auto p-5">
            <div className="grid grid-cols-2 gap-3">
              <Card className="p-4">
                <div className="mb-1 flex items-baseline justify-between">
                  <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-dim">
                    CPU
                  </h3>
                  <span className="font-mono text-[13px] tabular-nums text-foreground">
                    {cpuPct}%
                  </span>
                </div>
                <div className="h-28">
                  <Sparkline data={cpuHist} />
                </div>
              </Card>
              <Card className="p-4">
                <div className="mb-1 flex items-baseline justify-between">
                  <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-dim">
                    Memory
                  </h3>
                  <span className="font-mono text-[13px] tabular-nums text-foreground">
                    {memPct}%
                  </span>
                </div>
                <div className="h-28">
                  <Sparkline data={memHist} color="warning" />
                </div>
              </Card>
            </div>
            <p className="mt-3 font-mono text-2xs text-faint">
              Live usage sampled every 15s while this tab is open.
            </p>
          </div>
        )}

        {tab === 'events' && (
          <div className="h-full overflow-auto p-5">
            <EventList events={events} />
          </div>
        )}
      </div>
    </div>
  )
}
