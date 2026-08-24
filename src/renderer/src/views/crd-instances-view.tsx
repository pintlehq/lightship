import { useMemo } from 'react'
import {
  legacyCreateColumnHelper as createColumnHelper,
  type LegacyColumnDef as ColumnDef
} from '@tanstack/react-table/legacy'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@renderer/ui/components/button'
import { Card } from '@renderer/ui/components/card'
import { DataTable } from '@renderer/ui/components/data-table'
import { Icon } from '@renderer/ui/components/icon'

import type { CustomResourceColumn, ResourceRow } from '../../../shared/ipc-types'
import { qk } from '../queries/keys'
import { useCustomResource } from '../queries/use-lightship-data'
import { ViewHeader } from './view-header'

const HEADER_CELL =
  'text-left font-medium text-2xs uppercase tracking-[0.06em] text-dim px-2.5 py-1.5 bg-muted border-b border-border whitespace-nowrap'
const BODY_CELL = 'px-2.5 py-1.5 border-b border-border/50'

const col = createColumnHelper<ResourceRow>()

export function CrdInstancesView({
  clusterId,
  group,
  version,
  plural,
  namespaced,
  label,
  onOpenRow
}: {
  clusterId: string
  group: string
  version: string
  plural: string
  namespaced: boolean
  label: string
  onOpenRow?: (row: ResourceRow, columns: CustomResourceColumn[]) => void
}) {
  const params = { group, version, plural, namespaced }
  const { data, isLoading, isError, error } = useCustomResource(clusterId, params)
  const rows = data?.rows ?? []
  const printColumns = useMemo(() => data?.columns ?? [], [data?.columns])
  const qc = useQueryClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = useMemo<ColumnDef<ResourceRow, any>[]>(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cols: ColumnDef<ResourceRow, any>[] = [
      col.accessor('name', {
        header: 'NAME',
        size: 320,
        cell: (c) => <span className="text-foreground">{c.getValue()}</span>
      })
    ]
    if (namespaced) {
      cols.push(
        col.accessor((r) => r.namespace ?? '', {
          id: 'namespace',
          header: 'NAMESPACE',
          size: 200,
          meta: { cellClassName: 'text-muted-foreground' }
        })
      )
    }
    // The CRD's additional printer columns (server-rendered).
    for (const pc of printColumns) {
      cols.push(
        col.accessor((r) => r.columns[pc.key] ?? '', {
          id: `pc:${pc.key}`,
          header: pc.header.toUpperCase(),
          size: 160,
          meta: { cellClassName: 'text-muted-foreground' }
        })
      )
    }
    cols.push(
      col.accessor('age', { header: 'AGE', size: 90, meta: { cellClassName: 'text-faint' } })
    )
    return cols
  }, [namespaced, printColumns])

  return (
    <div className="flex h-full flex-col p-5">
      <ViewHeader
        crumbs={['cluster', 'custom resources']}
        title={label}
        meta={
          <span>
            {group}/{version} · {rows.length} items
          </span>
        }
      />
      <div className="mb-3 flex">
        <Button
          variant="outline"
          size="icon"
          className="ml-auto h-8 w-8"
          onClick={() =>
            void qc.invalidateQueries({ queryKey: qk.customResource(clusterId, params) })
          }
        >
          <Icon name="refresh" className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Card className="min-h-0 flex-1 overflow-hidden">
        {isError ? (
          <div className="grid h-full place-items-center gap-2 p-6 text-center font-mono text-[12.5px] text-destructive">
            <Icon name="x" className="h-7 w-7" />
            <span>{error instanceof Error ? error.message : 'Failed to load'}</span>
          </div>
        ) : isLoading ? (
          <div className="grid h-full place-items-center font-mono text-sm text-dim">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="grid h-full place-items-center gap-2.5 text-center font-mono text-[12.5px] text-dim">
            <Icon name="code" className="h-10 w-10 text-faint" />
            <span>No instances found</span>
          </div>
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(r) => r.uid}
            onRowClick={onOpenRow ? (r) => onOpenRow(r, printColumns) : undefined}
            resizableColumns
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
  )
}
