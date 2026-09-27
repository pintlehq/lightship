import { ActionMenu } from '@renderer/ui/components/action-menu'
import { Badge } from '@renderer/ui/components/badge'
import { Button } from '@renderer/ui/components/button'
import { Card } from '@renderer/ui/components/card'
import type { ContextMenuItemDef } from '@renderer/ui/components/context-menu'
import { DataTable } from '@renderer/ui/components/data-table'
import { Dot } from '@renderer/ui/components/dot'
import { Icon } from '@renderer/ui/components/icon'
import { Input } from '@renderer/ui/components/input'
import { Tabs } from '@renderer/ui/components/tabs'
import { TONE_TEXT } from '@renderer/ui/lib/tones'
import { cn } from '@renderer/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import type { RowSelectionState } from '@tanstack/react-table'
import {
  legacyCreateColumnHelper as createColumnHelper,
  type LegacyColumnDef as ColumnDef
} from '@tanstack/react-table/legacy'
import { useCallback, useMemo, useState } from 'react'
import { useNodeActions } from './use-node-actions'

import { toast } from '@renderer/ui/components/toaster'

import { NODE_STATUS } from '../../data/static'
import { useClusters } from '../../queries/clusters'
import { qk } from '../../queries/keys'
import { useUiStore } from '../../stores/ui-store'
import type { NodeRow } from '../../types'
import { BulkActionBar, type BulkAction } from '../../views/bulk-action-bar'
import { ConfirmDialog } from '../../views/confirm-dialog'
import { StatCard } from '../../views/stat-card'
import { ViewHeader } from '../../views/view-header'
import { nodeColumns } from './node-columns'
import { buildNodeRowMenu } from './node-row-menu'
import { useNodes } from './queries'

const HEADER_CELL =
  'text-left font-medium text-2xs uppercase tracking-[0.06em] text-dim px-2.5 py-2 bg-muted border-b border-border whitespace-nowrap'
const BODY_CELL = 'px-2.5 py-2 border-b border-border/50'

const col = createColumnHelper<NodeRow>()

export function NodesView({
  clusterId,
  onOpenNode
}: {
  clusterId: string
  onOpenNode?: (node: NodeRow) => void
}) {
  const { data: nodes = [], isLoading, isError, error } = useNodes(clusterId)
  const { data: clusters = [] } = useClusters()
  const readOnly = useUiStore((s) => s.readOnly)
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => {
    setRefreshing(true)
    await qc.invalidateQueries({ queryKey: qk.nodes(clusterId) })
    setRefreshing(false)
    toast.success('Refreshed nodes')
  }
  const clusterName = clusters.find((c) => c.id === clusterId)?.name ?? 'cluster'
  const [q, setQ] = useState('')
  const [view, setView] = useState('table')
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const clearSelection = useCallback(() => setRowSelection({}), [])
  const {
    pending,
    busy,
    drainProgress,
    drainReport,
    completedNodes,
    cancelRequested,
    start,
    runAction,
    cancelAction,
    confirmText
  } = useNodeActions(clusterId, clearSelection)

  const rows = useMemo(
    () => nodes.filter((n) => !q || n.name.includes(q) || n.zone.includes(q) || n.type.includes(q)),
    [nodes, q]
  )

  const byName = useMemo(() => new Map(nodes.map((n) => [n.name, n])), [nodes])
  const selected = Object.keys(rowSelection)
    .filter((k) => rowSelection[k])
    .map((name) => byName.get(name))
    .filter((n): n is NodeRow => !!n)

  // Context-aware: offer Cordon only when some selection is schedulable, Uncordon
  // only when some is cordoned; Drain always (it cordons + evicts).
  const actions: BulkAction[] = []
  if (selected.some((n) => !n.cordoned))
    actions.push({
      label: 'Cordon',
      icon: 'lock',
      disabled: readOnly,
      onClick: () => start('cordon', selected, true)
    })
  if (selected.some((n) => n.cordoned))
    actions.push({
      label: 'Uncordon',
      icon: 'check',
      disabled: readOnly,
      onClick: () => start('uncordon', selected, true)
    })
  actions.push({
    label: 'Drain',
    icon: 'download',
    danger: true,
    disabled: readOnly,
    onClick: () => start('drain', selected, true)
  })

  const rowItems = useCallback(
    (n: NodeRow): ContextMenuItemDef[] =>
      buildNodeRowMenu({
        cordoned: n.cordoned,
        readOnly,
        onCordon: () => start('cordon', [n]),
        onUncordon: () => start('uncordon', [n]),
        onDrain: () => start('drain', [n])
      }),
    [readOnly, start]
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = useMemo<ColumnDef<NodeRow, any>[]>(
    () => [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(nodeColumns as ColumnDef<NodeRow, any>[]),
      col.display({
        id: 'actions',
        size: 40,
        enableResizing: false,
        meta: { widthClassName: 'w-10' },
        header: () => null,
        cell: (c) => (
          <span onClick={(e) => e.stopPropagation()}>
            <ActionMenu items={rowItems(c.row.original)} />
          </span>
        )
      })
    ],
    [rowItems]
  )

  const ready = nodes.filter((n) => n.status === 'Ready').length
  const avgCpu = nodes.length
    ? Math.round(nodes.reduce((a, n) => a + n.cpuPct, 0) / nodes.length)
    : 0
  const avgMem = nodes.length
    ? Math.round(nodes.reduce((a, n) => a + n.memPct, 0) / nodes.length)
    : 0
  const totPods = nodes.reduce((a, n) => a + n.pods, 0)
  const zones = new Set(nodes.map((n) => n.zone).filter(Boolean)).size

  return (
    <div className="flex h-full flex-col p-5">
      <ViewHeader
        crumbs={[clusterName]}
        title="Nodes"
        meta={
          <span>
            {rows.length} of {nodes.length}
          </span>
        }
        live
      />

      <div className="mb-4 grid grid-cols-4 gap-3">
        <StatCard
          label="Nodes ready"
          value={`${ready}/${nodes.length}`}
          sub={ready < nodes.length ? `${nodes.length - ready} not ready` : 'all healthy'}
          subTone={ready < nodes.length ? 'up' : 'down'}
        />
        <StatCard
          label="Avg CPU"
          value={avgCpu}
          unit="%"
          bar={avgCpu}
          barTone={avgCpu >= 70 ? 'warning' : undefined}
        />
        <StatCard
          label="Avg memory"
          value={avgMem}
          unit="%"
          bar={avgMem}
          barTone={avgMem >= 70 ? 'warning' : undefined}
        />
        <StatCard
          label="Scheduled pods"
          value={totPods}
          sub={`across ${zones} zone${zones === 1 ? '' : 's'}`}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] max-w-md flex-1">
          <Icon
            name="search"
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter nodes, zone, instance type…"
            className="pl-8"
          />
        </div>
        <Tabs
          variant="segment"
          value={view}
          onChange={setView}
          tabs={[
            { value: 'table', label: 'Table', icon: 'table' },
            { value: 'cards', label: 'Cards', icon: 'layers' }
          ]}
        />
        <Button variant="outline" size="icon" disabled={refreshing} onClick={() => void refresh()}>
          <Icon name="refresh" className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </Button>
      </div>

      {isError ? (
        <Card className="grid min-h-0 flex-1 place-items-center p-6 text-center font-mono text-[12.5px] text-destructive">
          <div className="flex flex-col items-center gap-2">
            <Icon name="x" className="h-7 w-7" />
            <span>{error instanceof Error ? error.message : 'Failed to load nodes'}</span>
          </div>
        </Card>
      ) : isLoading ? (
        <Card className="grid min-h-0 flex-1 place-items-center font-mono text-sm text-dim">
          Loading nodes…
        </Card>
      ) : nodes.length === 0 ? (
        <Card className="grid min-h-0 flex-1 place-items-center text-center font-mono text-[12.5px] text-dim">
          <div className="flex flex-col items-center gap-2.5">
            <Icon name="server" className="h-10 w-10 text-faint" />
            <span>No nodes found</span>
          </div>
        </Card>
      ) : view === 'table' ? (
        <Card className="min-h-0 flex-1 overflow-hidden">
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(n) => n.name}
            onRowClick={onOpenNode}
            rowContextMenu={rowItems}
            enableRowSelection
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
            resizableColumns
            virtualize
            estimateRowHeight={41}
            stickyHeader
            containerClassName="h-full"
            className="font-mono text-[13px]"
            headerCellClassName={HEADER_CELL}
            cellClassName={BODY_CELL}
          />
        </Card>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid grid-cols-3 gap-3">
            {rows.map((n) => {
              const tone = NODE_STATUS[n.status] ?? 'dim'
              const cp = n.roles.includes('control-plane')
              return (
                <Card
                  key={n.name}
                  onClick={() => onOpenNode?.(n)}
                  className="cursor-pointer p-4 transition-colors hover:border-border-strong"
                >
                  <div className="mb-3 flex items-start gap-2.5">
                    <div
                      className={cn(
                        'grid h-8 w-8 shrink-0 place-items-center rounded-md border',
                        cp ? 'border-warning/30 bg-warning/10' : 'border-primary/25 bg-primary/10'
                      )}
                    >
                      <Icon
                        name="server"
                        className={cn('h-4 w-4', cp ? 'text-warning' : 'text-primary')}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[12.5px] text-foreground">
                        {n.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 font-mono text-2xs',
                            TONE_TEXT[tone]
                          )}
                        >
                          <Dot tone={tone} pulse={n.status === 'Ready'} />
                          {n.status}
                        </span>
                        <span className="font-mono text-2xs text-faint">· {n.zone}</span>
                      </div>
                    </div>
                    <Badge variant={cp ? 'warning' : 'secondary'}>{cp ? 'cp' : 'worker'}</Badge>
                  </div>
                  <div className="space-y-2 font-mono">
                    <div>
                      <div className="mb-1 flex justify-between text-2xs text-dim">
                        <span>CPU</span>
                        <span className="tabular-nums">{n.cpu} cores</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <span
                          className={cn(
                            'block h-full rounded-full',
                            n.cpuPct >= 85
                              ? 'bg-destructive'
                              : n.cpuPct >= 70
                                ? 'bg-warning'
                                : 'bg-primary'
                          )}
                          style={{ width: `${n.cpuPct}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-2xs text-dim">
                        <span>Memory</span>
                        <span className="tabular-nums">{n.mem}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <span
                          className={cn(
                            'block h-full rounded-full',
                            n.memPct >= 85
                              ? 'bg-destructive'
                              : n.memPct >= 70
                                ? 'bg-warning'
                                : 'bg-primary'
                          )}
                          style={{ width: `${n.memPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-3 border-t border-border/60 pt-3 font-mono text-2xs text-dim">
                    <span className="inline-flex items-center gap-1">
                      <Icon name="box" className="h-3 w-3" />
                      {n.pods} pods
                    </span>
                    <span>{n.type}</span>
                    <span className="ml-auto text-faint">{n.ver}</span>
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      <BulkActionBar
        count={selected.length}
        actions={actions}
        onClear={() => setRowSelection({})}
      />
      {pending && (
        <ConfirmDialog
          open
          danger={pending.op === 'drain'}
          busy={busy}
          cancellableWhileBusy={pending.op === 'drain' && !cancelRequested}
          cancelLabel={busy && cancelRequested ? 'Cancelling…' : drainReport ? 'Close' : undefined}
          title={confirmText[pending.op].title}
          message={
            pending.op === 'drain' ? (
              <div className="space-y-2">
                <p>{confirmText.drain.message}</p>
                {drainProgress && (
                  <div aria-live="polite">
                    <p>
                      {drainProgress.node}: {drainProgress.message}
                    </p>
                    {drainProgress.pods.length > 0 && (
                      <ul className="max-h-24 overflow-auto pl-4">
                        {drainProgress.pods.map((pod) => (
                          <li key={`${pod.namespace}/${pod.name}`}>
                            {pod.namespace}/{pod.name}: {pod.status}
                            {pod.reason ? ` — ${pod.reason}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {drainReport && (
                  <div role="status" className="space-y-1">
                    <p>Completed: {drainReport.completed.join(', ') || 'none'}</p>
                    {drainReport.interrupted && (
                      <>
                        <p>
                          {drainReport.interrupted.node}: {drainReport.interrupted.status} —{' '}
                          {drainReport.interrupted.reason}
                        </p>
                        {drainReport.interrupted.remaining.length > 0 && (
                          <p>
                            Eligible pods last observed:{' '}
                            {drainReport.interrupted.remaining
                              .map((pod) => `${pod.namespace}/${pod.name}`)
                              .join(', ')}
                          </p>
                        )}
                        {drainReport.interrupted.pods.some(
                          (pod) => pod.status === 'blocked' || pod.status === 'failed'
                        ) && (
                          <ul className="max-h-24 overflow-auto pl-4">
                            {drainReport.interrupted.pods
                              .filter((pod) => pod.status === 'blocked' || pod.status === 'failed')
                              .map((pod) => (
                                <li key={`${pod.namespace}/${pod.name}`}>
                                  {pod.namespace}/{pod.name}: {pod.status}
                                  {pod.reason ? ` — ${pod.reason}` : ''}
                                </li>
                              ))}
                          </ul>
                        )}
                      </>
                    )}
                    <p>Unprocessed: {drainReport.unprocessed.join(', ') || 'none'}</p>
                  </div>
                )}
              </div>
            ) : (
              confirmText[pending.op].message
            )
          }
          progress={
            pending.op === 'drain' && busy
              ? {
                  label: drainProgress?.message ?? 'Draining nodes',
                  done: completedNodes,
                  total: pending.nodes.length
                }
              : undefined
          }
          confirmLabel={drainReport ? 'Close' : confirmText[pending.op].label}
          onConfirm={runAction}
          onCancel={cancelAction}
        />
      )}
    </div>
  )
}
