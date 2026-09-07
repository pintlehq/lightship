import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ActionMenu } from '@renderer/ui/components/action-menu'
import { Badge } from '@renderer/ui/components/badge'
import { Button } from '@renderer/ui/components/button'
import { Card } from '@renderer/ui/components/card'
import { Icon } from '@renderer/ui/components/icon'
import { Input } from '@renderer/ui/components/input'
import { Tabs } from '@renderer/ui/components/tabs'
import { cn } from '@renderer/ui/lib/utils'

import type { NamespaceSummary } from '../../../shared/ipc-types'
import { qk } from '../queries/keys'
import {
  useClusters,
  useDeleteNamespace,
  useNamespaceSummaries
} from '../queries/use-lightship-data'
import { useUiStore } from '../stores/ui-store'
import { ConfirmDialog } from './confirm-dialog'
import { NewNamespaceDialog } from './new-namespace-dialog'
import { StatCard } from './stat-card'
import { ViewHeader } from './view-header'

export function NamespacesView({
  clusterId,
  onOpenNamespace,
  onOpenResource
}: {
  clusterId: string
  onOpenNamespace: (name: string) => void
  onOpenResource: (resourceId: string, label: string, namespace: string) => void
}) {
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
        <Button variant="outline" size="icon" onClick={refresh} disabled={query.isFetching}>
          <Icon name="refresh" className={cn('h-3.5 w-3.5', query.isFetching && 'animate-spin')} />
        </Button>
        <Button onClick={() => setCreating(true)} disabled={readOnly}>
          <Icon name="plus" className="h-3.5 w-3.5" />
          Create
        </Button>
      </div>
      <Card className="min-h-0 flex-1 overflow-auto">
        {query.isLoading ? (
          <div className="grid h-full place-items-center font-mono text-sm text-dim">
            Loading namespaces…
          </div>
        ) : query.isError ? (
          <div className="grid h-full place-items-center p-6 font-mono text-sm text-destructive">
            {query.error instanceof Error ? query.error.message : 'Failed to load namespaces'}
          </div>
        ) : (
          <table className="w-full table-fixed font-mono text-[12px]">
            <thead className="sticky top-0 z-10 bg-muted text-left text-2xs uppercase tracking-[0.06em] text-dim">
              <tr>
                {[
                  'Name',
                  'Status',
                  'Ready / pods',
                  'Quotas',
                  'Limit ranges',
                  'Policies',
                  'Age',
                  ''
                ].map((heading) => (
                  <th key={heading} className="border-b border-border px-3 py-2 font-medium">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr
                  key={item.uid}
                  className="cursor-pointer border-b border-border/50 hover:bg-hover"
                  onClick={() => onOpenNamespace(item.name)}
                >
                  <td className="truncate px-3 py-2.5 text-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Icon name="folder" className="h-3.5 w-3.5 text-primary" />
                      {item.name}
                      {item.protected && <Icon name="lock" className="h-3 w-3 text-faint" />}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
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
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                    {item.podsTotal == null ? '—' : `${item.podsReady}/${item.podsTotal}`}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{item.quotaCount ?? '—'}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {item.limitRangeCount ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {item.networkPolicyCount ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-dim">{item.age || '—'}</td>
                  <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
