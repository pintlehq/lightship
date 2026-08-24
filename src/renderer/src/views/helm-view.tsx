import {
  legacyCreateColumnHelper as createColumnHelper,
  type LegacyColumnDef as ColumnDef
} from '@tanstack/react-table/legacy'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@renderer/ui/components/button'
import { Card } from '@renderer/ui/components/card'
import { DataTable } from '@renderer/ui/components/data-table'
import { Icon } from '@renderer/ui/components/icon'

import type { HelmRelease } from '../../../shared/ipc-types'
import { qk } from '../queries/keys'
import { useHelmReleases } from '../queries/use-lightship-data'
import { ViewHeader } from './view-header'

const HEADER_CELL =
  'text-left font-medium text-2xs uppercase tracking-[0.06em] text-dim px-2.5 py-1.5 bg-muted border-b border-border whitespace-nowrap'
const BODY_CELL = 'px-2.5 py-1.5 border-b border-border/50'

const col = createColumnHelper<HelmRelease>()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const columns: ColumnDef<HelmRelease, any>[] = [
  col.accessor('name', {
    header: 'NAME',
    size: 220,
    cell: (c) => <span className="text-foreground">{c.getValue()}</span>
  }),
  col.accessor('namespace', {
    header: 'NAMESPACE',
    size: 160,
    meta: { cellClassName: 'text-muted-foreground' }
  }),
  col.accessor((r) => String(r.revision), {
    id: 'revision',
    header: 'REV',
    size: 70,
    meta: { align: 'right', cellClassName: 'tabular-nums text-muted-foreground' }
  }),
  col.accessor((r) => (r.chartVersion ? `${r.chart}-${r.chartVersion}` : r.chart), {
    id: 'chart',
    header: 'CHART',
    size: 200,
    meta: { cellClassName: 'text-muted-foreground' }
  }),
  col.accessor('appVersion', { header: 'APP', size: 120, meta: { cellClassName: 'text-dim' } }),
  col.accessor('status', { header: 'STATUS', size: 130 }),
  col.accessor('updated', { header: 'UPDATED', size: 90, meta: { cellClassName: 'text-faint' } })
]

export function HelmView({
  clusterId,
  onOpenRelease
}: {
  clusterId: string
  onOpenRelease: (r: HelmRelease) => void
}) {
  const { data: rows = [], isLoading, isError, error } = useHelmReleases(clusterId)
  const qc = useQueryClient()

  return (
    <div className="flex h-full flex-col p-5">
      <ViewHeader
        crumbs={['cluster']}
        title="Helm Releases"
        meta={<span>{rows.length} releases</span>}
      />
      <div className="mb-3 flex">
        <Button
          variant="outline"
          size="icon"
          className="ml-auto h-8 w-8"
          onClick={() => void qc.invalidateQueries({ queryKey: qk.helmReleases(clusterId) })}
        >
          <Icon name="refresh" className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Card className="min-h-0 flex-1 overflow-hidden">
        {isError ? (
          <div className="grid h-full place-items-center gap-2 p-6 text-center font-mono text-[12.5px] text-destructive">
            <Icon name="x" className="h-7 w-7" />
            <span>{error instanceof Error ? error.message : 'Failed to load releases'}</span>
          </div>
        ) : isLoading ? (
          <div className="grid h-full place-items-center font-mono text-sm text-dim">
            Loading releases…
          </div>
        ) : rows.length === 0 ? (
          <div className="grid h-full place-items-center gap-2.5 text-center font-mono text-[12.5px] text-dim">
            <Icon name="zap" className="h-10 w-10 text-faint" />
            <span>No Helm releases found</span>
          </div>
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(r) => `${r.namespace}/${r.name}`}
            onRowClick={onOpenRelease}
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
