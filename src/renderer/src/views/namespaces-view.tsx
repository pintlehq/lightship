import { ActionMenu } from '@renderer/ui/components/action-menu'
import { Badge } from '@renderer/ui/components/badge'
import { Button } from '@renderer/ui/components/button'
import { DataTable } from '@renderer/ui/components/data-table'
import { durationValue } from '@renderer/ui/lib/table-sorting'
import type { SortingState } from '@tanstack/react-table'
import { legacyCreateColumnHelper as createColumnHelper } from '@tanstack/react-table/legacy'
import { Card } from '@renderer/ui/components/card'
import { Icon } from '@renderer/ui/components/icon'
import { Input } from '@renderer/ui/components/input'
import { Tabs } from '@renderer/ui/components/tabs'
import { cn } from '@renderer/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import type { NamespaceSummary } from '../../../shared/ipc-types'
import { useClusters } from '../queries/clusters'
import { qk } from '../queries/keys'
import { useDeleteNamespace, useNamespaceSummaries } from '../queries/namespaces'
import { useUiStore } from '../stores/ui-store'
import { ConfirmDialog } from './confirm-dialog'
import { NewNamespaceDialog } from './new-namespace-dialog'
import { StatCard } from './stat-card'
import { ViewHeader } from './view-header'

const col = createColumnHelper<NamespaceSummary>()

export function NamespacesView({
  clusterId,
  onOpenNamespace,
  onOpenResource
}: {
  clusterId: string
  onOpenNamespace: (name: string) => void
  onOpenResource: (resourceId: string, label: string, namespace: string) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const query = useNamespaceSummaries(clusterId)
  const { data: clusters = [] } = useClusters()
  const qc = useQueryClient()
  const remove = useDeleteNamespace(clusterId)
  const readOnly = useUiStore((state) => state.readOnly)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<NamespaceSummary | null>(null)
  const items = query.data?.items ?? []
  const rows = items.filter(
    (item) =>
      (!search || item.name.toLowerCase().includes(search.toLowerCase())) &&
      (status === 'all' || item.status.toLowerCase() === status)
  )
  const unavailable = Object.entries(query.data?.access ?? {}).filter(
    ([, access]) => !access.available
  )
  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: qk.namespaceSummaries(clusterId) })
  }
  const clusterName = clusters.find((cluster) => cluster.id === clusterId)?.name ?? 'cluster'
  const active = items.filter((item) => item.status === 'Active').length
  const terminating = items.filter((item) => item.status === 'Terminating').length
  const withQuotas = query.data?.access.quotas.available
    ? items.filter((item) => (item.quotaCount ?? 0) > 0).length
    : '—'

  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: 'Name',
        meta: { cellClassName: 'truncate text-foreground' },
        cell: (c) => {
          const item = c.row.original
          return (
            <span className="inline-flex items-center gap-2">
              <Icon name="folder" className="h-3.5 w-3.5 text-primary" />
              {item.name}
              {item.protected && <Icon name="lock" className="h-3 w-3 text-faint" />}
            </span>
          )
        }
      }),
      col.accessor('status', {
        header: 'Status',
        cell: (c) => {
          const item = c.row.original
          return (
            <Badge
              variant={
                item.status === 'Active'
                  ? 'success'
                  : item.status === 'Terminating'
                    ? 'warning'
                    : 'secondary'
              }
            >
              {item.status}
            </Badge>
          )
        }
      }),
      col.accessor('podsReady', {
        header: 'Ready / pods',
        meta: {
          cellClassName: 'tabular-nums text-muted-foreground',
          sortValue: (item) =>
            item.podsTotal == null || item.podsReady == null
              ? undefined
              : [item.podsReady, item.podsTotal]
        },
        cell: (c) => {
          const item = c.row.original
          return <>{item.podsTotal == null ? '—' : `${item.podsReady}/${item.podsTotal}`}</>
        }
      }),
      col.accessor('quotaCount', {
        header: 'Quotas',
        meta: { cellClassName: 'text-muted-foreground' },
        cell: (c) => {
          const item = c.row.original
          return <>{item.quotaCount ?? '—'}</>
        }
      }),
      col.accessor('limitRangeCount', {
        header: 'Limit ranges',
        meta: { cellClassName: 'text-muted-foreground' },
        cell: (c) => {
          const item = c.row.original
          return <>{item.limitRangeCount ?? '—'}</>
        }
      }),
      col.accessor('networkPolicyCount', {
        header: 'Policies',
        meta: { cellClassName: 'text-muted-foreground' },
        cell: (c) => {
          const item = c.row.original
          return <>{item.networkPolicyCount ?? '—'}</>
        }
      }),
      col.accessor('age', {
        header: 'Age',
        meta: { cellClassName: 'text-dim', sortValue: (item) => durationValue(item.age) },
        cell: (c) => {
          const item = c.row.original
          return <>{item.age || '—'}</>
        }
      }),
      col.display({
        id: 'actions',
        enableResizing: false,
        enableSorting: false,
        header: '',
        cell: (c) => {
          const item = c.row.original
          return (
            <span onClick={(event) => event.stopPropagation()}>
              <ActionMenu
                items={[
                  { label: 'Open', onSelect: () => onOpenNamespace(item.name) },
                  {
                    label: 'View pods',
                    onSelect: () => onOpenResource('pods', 'Pods', item.name)
                  },
                  {
                    label: 'Delete',
                    danger: true,
                    separatorBefore: true,
                    disabled: readOnly || item.protected,
                    onSelect: () => setDeleting(item)
                  }
                ]}
              />
            </span>
          )
        }
      })
    ],
    [onOpenNamespace, onOpenResource, readOnly]
  )

  return (
    <div className="flex h-full min-h-0 flex-col p-5">
      <ViewHeader
        crumbs={[clusterName]}
        title="Namespaces"
        meta={
          <span>
            {rows.length} of {items.length}
          </span>
        }
      />
      <div className="mb-4 grid grid-cols-4 gap-3">
        <StatCard label="Total" value={items.length} />
        <StatCard label="Active" value={active} />
        <StatCard label="Terminating" value={terminating} />
        <StatCard label="With quotas" value={withQuotas} />
      </div>
      {unavailable.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 font-mono text-[11.5px] text-warning">
          <Icon name="alertTriangle" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Some data is unavailable due to cluster permissions:{' '}
            {unavailable.map(([source]) => source).join(', ')}. A dash is shown instead of zero.
          </span>
        </div>
      )}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Icon
            name="search"
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
          />
          <Input
            className="pl-8"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter namespaces…"
          />
        </div>
        <Tabs
          variant="segment"
          value={status}
          onChange={setStatus}
          tabs={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'terminating', label: 'Terminating' }
          ]}
        />
        <Button
          aria-label="Refresh namespaces"
          variant="outline"
          size="icon"
          onClick={refresh}
          disabled={query.isFetching}
        >
          <Icon name="refresh" className={cn('h-3.5 w-3.5', query.isFetching && 'animate-spin')} />
        </Button>
        <Button onClick={() => setCreating(true)} disabled={readOnly}>
          <Icon name="plus" className="h-3.5 w-3.5" />
          Create
        </Button>
      </div>
      <Card className="min-h-0 flex-1 overflow-hidden">
        {query.isLoading ? (
          <div className="grid h-full place-items-center font-mono text-sm text-dim">
            Loading namespaces…
          </div>
        ) : query.isError ? (
          <div className="grid h-full place-items-center p-6 font-mono text-sm text-destructive">
            {query.error instanceof Error ? query.error.message : 'Failed to load namespaces'}
          </div>
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(item) => item.uid}
            onRowClick={(item) => onOpenNamespace(item.name)}
            enableSorting
            sorting={sorting}
            onSortingChange={setSorting}
            stickyHeader
            className="w-full table-fixed font-mono text-[12px]"
            containerClassName="h-full"
            headerCellClassName="border-b border-border bg-muted px-3 py-2 text-left text-2xs uppercase tracking-[0.06em] text-dim font-medium"
            cellClassName="px-3 py-2.5 border-b border-border/50"
            emptyState="No namespaces found"
          />
        )}
      </Card>
      <NewNamespaceDialog
        clusterId={clusterId}
        open={creating}
        onClose={() => setCreating(false)}
      />
      {deleting && (
        <ConfirmDialog
          open
          danger
          busy={remove.isPending}
          title={`Delete namespace ${deleting.name}?`}
          message="This deletes all namespaced resources. The namespace may remain Terminating while finalizers run."
          confirmLabel="Delete namespace"
          confirmationText={deleting.name}
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.name, { onSuccess: () => setDeleting(null) })}
        />
      )}
    </div>
  )
}
