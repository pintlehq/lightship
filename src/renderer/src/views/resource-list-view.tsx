import { useCallback, useMemo, useState } from 'react'
import type { RowSelectionState } from '@tanstack/react-table'
import {
  legacyCreateColumnHelper as createColumnHelper,
  type LegacyColumnDef as ColumnDef
} from '@tanstack/react-table/legacy'
import { useQueryClient } from '@tanstack/react-query'
import { ActionMenu } from '@renderer/ui/components/action-menu'
import { Button } from '@renderer/ui/components/button'
import { Card } from '@renderer/ui/components/card'
import type { ContextMenuItemDef } from '@renderer/ui/components/context-menu'
import { DataTable } from '@renderer/ui/components/data-table'
import { Icon } from '@renderer/ui/components/icon'
import { Input } from '@renderer/ui/components/input'
import { MultiSelect, type MultiSelectOption } from '@renderer/ui/components/multi-select'
import { toast } from '@renderer/ui/components/toaster'

import {
  canLogResource,
  canRestartResource,
  canScaleResource
} from '../../../shared/resource-capabilities'
import type { ResourceRow } from '../../../shared/ipc-types'
import { qk } from '../queries/keys'
import { useNamespaces, useResource } from '../queries/use-lightship-data'
import { RESOURCE_REGISTRY } from '../resources/registry'
import { useNamespaceFilterStore } from '../stores/namespace-filter-store'
import { useUiStore } from '../stores/ui-store'
import { BulkActionBar, type BulkAction } from './bulk-action-bar'
import { ConfirmDialog } from './confirm-dialog'
import { NewResourceDialog } from './new-resource-dialog'
import { buildResourceRowMenu } from './resource-row-menu'
import { ScaleResourceDialog } from './scale-resource-dialog'
import { useResourceActions } from './use-resource-actions'
import { ViewHeader } from './view-header'

const HEADER_CELL =
  'text-left font-medium text-2xs uppercase tracking-[0.06em] text-dim px-2.5 py-1.5 bg-muted border-b border-border whitespace-nowrap'
const BODY_CELL = 'px-2.5 py-1.5 border-b border-border/50'

const col = createColumnHelper<ResourceRow>()

export function ResourceListView({
  clusterId,
  resourceId,
  label,
  tabId,
  onOpenRow,
  onOpenLogs
}: {
  clusterId: string
  resourceId: string
  label: string
  tabId: string
  onOpenRow?: (row: ResourceRow) => void
  onOpenLogs?: (row: ResourceRow) => void
}) {
  const desc = RESOURCE_REGISTRY[resourceId]
  const loggable = canLogResource(resourceId)
  const restartable = canRestartResource(resourceId)
  const scalable = canScaleResource(resourceId)
  const {
    data: rows = [],
    isLoading,
    isError,
    error,
    isFetching
  } = useResource(clusterId, resourceId)
  const { data: nsList = [] } = useNamespaces(clusterId)
  const readOnly = useUiStore((s) => s.readOnly)
  const nsSel = useNamespaceFilterStore((s) => s.byTab[tabId] ?? s.last)
  const setNs = useNamespaceFilterStore((s) => s.setFor)
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [creating, setCreating] = useState(false)
  const [scaling, setScaling] = useState<ResourceRow[] | null>(null)
  const clearSelection = useCallback(() => setRowSelection({}), [])
  const { pending, busy, progress, startAction, cancelAction, runAction } = useResourceActions({
    clusterId,
    resourceId,
    label,
    onSelectionActionComplete: clearSelection
  })

  // Namespace options = every cluster namespace (from the backend), unioned with
  // namespaces present in the loaded rows (keeps the plain-browser mock working);
  // counts come from the loaded rows.
  const nsOptions = useMemo<MultiSelectOption[]>(() => {
    const counts: Record<string, number> = {}
    for (const r of rows) {
      const ns = r.namespace ?? ''
      counts[ns] = (counts[ns] ?? 0) + 1
    }
    const names = new Set<string>(nsList.map((r) => r.name))
    for (const ns of Object.keys(counts)) names.add(ns)
    return [...names].sort().map((ns) => ({ value: ns, count: counts[ns] ?? 0 }))
  }, [rows, nsList])

  // Drop remembered namespaces that don't exist in the loaded data → show all.
  const effectiveNs = useMemo(() => {
    if (nsOptions.length === 0) return nsSel
    const known = new Set(nsOptions.map((o) => o.value))
    return nsSel.filter((ns) => known.has(ns))
  }, [nsSel, nsOptions])

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!q ||
            r.name.toLowerCase().includes(q.toLowerCase()) ||
            (r.namespace ?? '').toLowerCase().includes(q.toLowerCase())) &&
          (effectiveNs.length === 0 || effectiveNs.includes(r.namespace ?? ''))
      ),
    [rows, q, effectiveNs]
  )

  const byUid = useMemo(() => new Map(rows.map((r) => [r.uid, r])), [rows])
  const selected = Object.keys(rowSelection)
    .filter((k) => rowSelection[k])
    .map((uid) => byUid.get(uid))
    .filter((r): r is ResourceRow => !!r)

  // The per-row menu, shared by the leading kebab and the right-click context menu.
  const rowItems = useCallback(
    (row: ResourceRow): ContextMenuItemDef[] =>
      buildResourceRowMenu({
        loggable,
        restartable,
        scalable,
        readOnly,
        onOpen: () => onOpenRow?.(row),
        onLogs: () => onOpenLogs?.(row),
        onRestart: () => startAction('restart', [row]),
        onScale: () => setScaling([row]),
        onDelete: () => startAction('delete', [row])
      }),
    [loggable, restartable, scalable, readOnly, onOpenRow, onOpenLogs, startAction]
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = useMemo<ColumnDef<ResourceRow, any>[]>(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cols: ColumnDef<ResourceRow, any>[] = [
      col.accessor('name', {
        header: 'NAME',
        size: 260,
        cell: (c) => <span className="text-foreground">{c.getValue()}</span>
      })
    ]
    if (desc?.namespaced) {
      cols.push(
        col.accessor((r) => r.namespace ?? '', {
          id: 'namespace',
          header: 'NAMESPACE',
          size: 160,
          meta: { cellClassName: 'text-muted-foreground' }
        })
      )
    }
    for (const rc of desc?.columns ?? []) {
      cols.push(
        col.accessor((r) => r.columns[rc.key] ?? '', {
          id: rc.key,
          header: rc.header,
          size: 150,
          meta: { align: rc.align, cellClassName: 'text-muted-foreground' }
        })
      )
    }
    cols.push(
      col.accessor('age', { header: 'AGE', size: 90, meta: { cellClassName: 'text-faint' } })
    )
    // Trailing kebab actions column (rightmost).
    cols.push(
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
    )
    return cols
  }, [desc, rowItems])

  const actions: BulkAction[] = [
    {
      label: 'Delete',
      icon: 'trash',
      danger: true,
      disabled: readOnly,
      onClick: () => startAction('delete', selected, true)
    }
  ]
  if (restartable) {
    actions.push({
      label: 'Rolling restart',
      icon: 'refresh',
      disabled: readOnly,
      onClick: () => startAction('restart', selected, true)
    })
  }
  if (scalable) {
    actions.splice(1, 0, {
      label: 'Scale',
      icon: 'chevronsUpDown',
      disabled: readOnly,
      onClick: () => setScaling(selected)
    })
  }

  return (
    <div className="flex h-full flex-col p-5">
      <ViewHeader
        crumbs={['cluster']}
        title={label}
        meta={<span>{filtered.length} items</span>}
        live
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] max-w-md flex-1">
          <Icon
            name="search"
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Filter ${label.toLowerCase()}…`}
            className="pl-8"
          />
        </div>
        {desc?.namespaced && (
          <MultiSelect
            label="Namespace"
            options={nsOptions}
            selected={effectiveNs}
            onChange={(ns) => setNs(tabId, ns)}
          />
        )}
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={isFetching}
            onClick={() => {
              void qc
                .invalidateQueries({ queryKey: qk.resource(clusterId, resourceId) })
                .then(() => toast.success(`Refreshed ${label}`))
            }}
          >
            <Icon name="refresh" className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="default" disabled={readOnly} onClick={() => setCreating(true)}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            New from YAML
          </Button>
        </div>
      </div>

      <Card className="min-h-0 flex-1 overflow-hidden">
        {isError ? (
          <div className="grid h-full place-items-center gap-2 p-6 text-center font-mono text-[12.5px] text-destructive">
            <Icon name="x" className="h-7 w-7" />
            <span>{error instanceof Error ? error.message : 'Failed to load'}</span>
          </div>
        ) : isLoading ? (
          <div className="grid h-full place-items-center font-mono text-sm text-dim">
            Loading {label.toLowerCase()}…
          </div>
        ) : filtered.length === 0 ? (
          <div className="grid h-full place-items-center">
            <div className="flex flex-col items-center gap-2.5 text-center font-mono text-[12.5px] text-dim">
              <Icon name="layers" className="h-10 w-10 text-faint" />
              <span>No {label.toLowerCase()} found</span>
            </div>
          </div>
        ) : (
          <DataTable
            data={filtered}
            columns={columns}
            getRowId={(r) => r.uid}
            onRowClick={onOpenRow}
            rowContextMenu={rowItems}
            enableRowSelection
            resizableColumns
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
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

      <BulkActionBar count={selected.length} actions={actions} onClear={clearSelection} />
      <ConfirmDialog
        open={pending !== null}
        danger={pending?.op === 'delete'}
        busy={busy}
        progress={progress ?? undefined}
        title={
          pending?.op === 'delete'
            ? `Delete ${pending.rows.length} ${label.toLowerCase()}?`
            : `Rolling restart ${pending?.rows.length ?? 0} ${label.toLowerCase()}?`
        }
        message={
          pending?.op === 'delete'
            ? 'This permanently deletes the selected resources from the cluster. This cannot be undone.'
            : 'This patches each workload to trigger a rolling restart of its pods.'
        }
        confirmLabel={pending?.op === 'delete' ? 'Delete' : 'Restart'}
        onConfirm={runAction}
        onCancel={cancelAction}
      />
      <NewResourceDialog
        clusterId={clusterId}
        kind={resourceId}
        open={creating}
        onClose={() => setCreating(false)}
        defaultNamespace={nsSel[0]}
      />
      {scaling && (
        <ScaleResourceDialog
          clusterId={clusterId}
          resourceId={resourceId}
          resourceLabel={label}
          rows={scaling}
          open={scaling !== null}
          readOnly={readOnly}
          onComplete={() => {
            if (scaling.length > 1) clearSelection()
          }}
          onClose={() => setScaling(null)}
        />
      )}
    </div>
  )
}
