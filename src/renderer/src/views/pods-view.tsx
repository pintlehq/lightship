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

import { podColumns } from '../columns/pod-columns'
import { POD_STATUS } from '../data/static'
import { errMsg } from '../lib/errors'
import { clusterApi } from '../lib/ipc'
import { qk } from '../queries/keys'
import { useNamespaces, usePods } from '../queries/use-lightship-data'
import { useNamespaceFilterStore } from '../stores/namespace-filter-store'
import { useUiStore } from '../stores/ui-store'
import type { Pod } from '../types'
import { BulkActionBar, type BulkAction } from './bulk-action-bar'
import { ConfirmDialog } from './confirm-dialog'
import { NewResourceDialog } from './new-resource-dialog'
import { buildPodRowMenu } from './pod-row-menu'
import { ViewHeader } from './view-header'

const HEADER_CELL =
  'text-left font-medium text-2xs uppercase tracking-[0.06em] text-dim px-2.5 py-1.5 bg-muted border-b border-border whitespace-nowrap'
const BODY_CELL = 'px-2.5 py-1.5 border-b border-border/50'

const podId = (p: Pod) => `${p.ns}/${p.name}`
const col = createColumnHelper<Pod>()

export function PodsView({
  clusterId,
  onOpenPod,
  onOpenLogs,
  onExec,
  tabId
}: {
  clusterId: string
  onOpenPod: (pod: Pod) => void
  onOpenLogs: (pods: Pod[], container?: string) => void
  onExec: (pod: Pod, container?: string) => void
  tabId: string
}) {
  const { data: pods = [], isLoading, isError, error } = usePods(clusterId)
  const { data: nsList = [] } = useNamespaces(clusterId)
  const readOnly = useUiStore((s) => s.readOnly)
  const nsSel = useNamespaceFilterStore((s) => s.byTab[tabId] ?? s.last)
  const setNs = useNamespaceFilterStore((s) => s.setFor)
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [statusSel, setStatusSel] = useState<string[]>([])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  // Pods pending deletion — a single row (kebab / right-click) or the whole
  // selection (bulk bar); selection is only cleared for the latter.
  const [pending, setPending] = useState<{ pods: Pod[]; fromSelection: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)

  // Namespace options = every cluster namespace (from the backend), unioned with
  // namespaces present in the loaded pods (keeps the plain-browser mock working);
  // counts come from the loaded pods.
  const nsOptions = useMemo<MultiSelectOption[]>(() => {
    const counts: Record<string, number> = {}
    for (const p of pods) counts[p.ns] = (counts[p.ns] ?? 0) + 1
    const names = new Set<string>(nsList.map((r) => r.name))
    for (const ns of Object.keys(counts)) names.add(ns)
    return [...names].sort().map((ns) => ({ value: ns, count: counts[ns] ?? 0 }))
  }, [pods, nsList])

  // Status options = the known statuses (static map), unioned with any status
  // actually present in the loaded pods; counts come from the loaded pods.
  const statusOptions = useMemo<MultiSelectOption[]>(() => {
    const counts: Record<string, number> = {}
    for (const p of pods) counts[p.status] = (counts[p.status] ?? 0) + 1
    const names = new Set<string>(Object.keys(POD_STATUS))
    for (const s of Object.keys(counts)) names.add(s)
    return [...names].sort().map((s) => ({ value: s, count: counts[s] ?? 0, tone: POD_STATUS[s] }))
  }, [pods])

  // Drop remembered namespaces that don't exist in the loaded data → show all.
  const effectiveNs = useMemo(() => {
    if (nsOptions.length === 0) return nsSel
    const known = new Set(nsOptions.map((o) => o.value))
    return nsSel.filter((ns) => known.has(ns))
  }, [nsSel, nsOptions])

  const rows = useMemo(
    () =>
      pods.filter(
        (p) =>
          (!q || p.name.includes(q) || p.ns.includes(q)) &&
          (effectiveNs.length === 0 || effectiveNs.includes(p.ns)) &&
          (statusSel.length === 0 || statusSel.includes(p.status))
      ),
    [pods, q, effectiveNs, statusSel]
  )

  const byId = useMemo(() => new Map(pods.map((p) => [podId(p), p])), [pods])
  const selected = Object.keys(rowSelection)
    .filter((k) => rowSelection[k])
    .map((id) => byId.get(id))
    .filter((p): p is Pod => !!p)

  const deletePods = async () => {
    if (!pending || !clusterId) return
    const { pods: target } = pending
    setBusy(true)
    try {
      for (const p of target) {
        await clusterApi.deleteResource(clusterId, { kind: 'pods', namespace: p.ns, name: p.name })
      }
      await qc.invalidateQueries({ queryKey: qk.pods(clusterId) })
      if (pending.fromSelection) setRowSelection({})
      toast.success(`Deleted ${target.length} pod${target.length > 1 ? 's' : ''}`)
    } catch (e) {
      console.error(e)
      toast.error('Failed to delete pods', errMsg(e))
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  const rowItems = useCallback(
    (p: Pod): ContextMenuItemDef[] =>
      buildPodRowMenu({
        containers: p.containers.map((c) => c.name),
        readOnly,
        onOpen: () => onOpenPod(p),
        onLogs: (c) => onOpenLogs([p], c),
        onExec: (c) => onExec(p, c),
        onDelete: () => setPending({ pods: [p], fromSelection: false })
      }),
    [readOnly, onOpenPod, onOpenLogs, onExec]
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = useMemo<ColumnDef<Pod, any>[]>(
    () => [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(podColumns as ColumnDef<Pod, any>[]),
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

  // Logs/Exec are per-row only (kebab / right-click); bulk acts on the selection.
  const actions: BulkAction[] = [
    {
      label: 'Delete',
      icon: 'trash',
      danger: true,
      disabled: readOnly,
      onClick: () => setPending({ pods: selected, fromSelection: true })
    }
  ]

  return (
    <div className="flex h-full flex-col p-5">
      <ViewHeader
        crumbs={['cluster', 'workloads']}
        title="Pods"
        meta={<span>{rows.length} items</span>}
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
            placeholder="Filter pods, namespace, status…"
            className="pl-8"
          />
        </div>
        <MultiSelect
          label="Namespace"
          options={nsOptions}
          selected={effectiveNs}
          onChange={(ns) => setNs(tabId, ns)}
        />
        <MultiSelect
          label="Status"
          options={statusOptions}
          selected={statusSel}
          onChange={setStatusSel}
        />
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => void qc.invalidateQueries({ queryKey: qk.pods(clusterId) })}
          >
            <Icon name="refresh" className="h-3.5 w-3.5" />
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
            <span>{error instanceof Error ? error.message : 'Failed to load pods'}</span>
          </div>
        ) : isLoading ? (
          <div className="grid h-full place-items-center font-mono text-sm text-dim">
            Loading pods…
          </div>
        ) : rows.length === 0 ? (
          <div className="grid h-full place-items-center gap-2.5 text-center font-mono text-[12.5px] text-dim">
            <Icon name="box" className="h-10 w-10 text-faint" />
            <span>No pods found</span>
          </div>
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            getRowId={podId}
            onRowClick={onOpenPod}
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

      <BulkActionBar
        count={selected.length}
        actions={actions}
        onClear={() => setRowSelection({})}
      />
      <ConfirmDialog
        open={pending !== null}
        danger
        busy={busy}
        title={`Delete ${pending?.pods.length ?? 0} pod${(pending?.pods.length ?? 0) > 1 ? 's' : ''}?`}
        message="This permanently deletes the selected pods. Controller-managed pods will be recreated."
        confirmLabel="Delete"
        onConfirm={deletePods}
        onCancel={() => setPending(null)}
      />
      <NewResourceDialog
        clusterId={clusterId}
        kind="pods"
        open={creating}
        onClose={() => setCreating(false)}
      />
    </div>
  )
}
