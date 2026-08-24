import { legacyCreateColumnHelper as createColumnHelper } from '@tanstack/react-table/legacy'
import { Badge } from '@renderer/ui/components/badge'
import { Dot } from '@renderer/ui/components/dot'
import { Icon } from '@renderer/ui/components/icon'
import { cn } from '@renderer/ui/lib/utils'
import { TONE_TEXT } from '@renderer/ui/lib/tones'

import { NODE_STATUS } from '../data/static'
import type { NodeRow } from '../types'
import { UsageBar } from '../views/usage-bar'

const col = createColumnHelper<NodeRow>()

export const nodeColumns = [
  col.accessor('name', {
    header: 'NAME',
    size: 220,
    cell: (c) => {
      const cp = c.row.original.roles.includes('control-plane')
      return (
        <span className="inline-flex items-center gap-2 text-foreground">
          <Icon name="server" className={cn('h-3.5 w-3.5', cp ? 'text-warning' : 'text-primary')} />
          {c.getValue()}
        </span>
      )
    }
  }),
  col.display({
    id: 'role',
    header: 'ROLE',
    size: 120,
    cell: (c) => {
      const cp = c.row.original.roles.includes('control-plane')
      return <Badge variant={cp ? 'warning' : 'secondary'}>{cp ? 'control-plane' : 'worker'}</Badge>
    }
  }),
  col.accessor('status', {
    header: 'STATUS',
    size: 140,
    cell: (c) => {
      const status = c.getValue()
      const tone = NODE_STATUS[status] ?? 'dim'
      return (
        <span className={cn('inline-flex items-center gap-1.5', TONE_TEXT[tone])}>
          <Dot tone={tone} pulse={status === 'Ready'} />
          {status}
          {c.row.original.cordoned && (
            <span className="ml-1.5 text-2xs text-warning">●&#8202;cordoned</span>
          )}
          {c.row.original.taint && (
            <span className="ml-1.5 text-2xs text-warning">●&#8202;taint</span>
          )}
        </span>
      )
    }
  }),
  col.accessor('cpuPct', {
    header: 'CPU',
    size: 130,
    cell: (c) => <UsageBar pct={c.getValue()} />
  }),
  col.accessor('memPct', {
    header: 'MEMORY',
    size: 130,
    cell: (c) => <UsageBar pct={c.getValue()} />
  }),
  col.accessor('pods', {
    header: 'PODS',
    size: 100,
    meta: { cellClassName: 'tabular-nums text-muted-foreground' },
    cell: (c) => (
      <>
        {c.getValue()}
        <span className="text-faint"> / {c.row.original.maxPods}</span>
      </>
    )
  }),
  col.accessor('zone', {
    header: 'ZONE',
    size: 130,
    meta: { cellClassName: 'text-muted-foreground' }
  }),
  col.accessor('type', { header: 'INSTANCE', size: 150, meta: { cellClassName: 'text-dim' } }),
  col.accessor('ver', { header: 'VERSION', size: 120, meta: { cellClassName: 'text-dim' } }),
  col.accessor('age', { header: 'AGE', size: 70, meta: { cellClassName: 'text-faint' } })
]
