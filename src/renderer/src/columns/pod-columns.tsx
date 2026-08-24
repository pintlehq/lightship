import { legacyCreateColumnHelper as createColumnHelper } from '@tanstack/react-table/legacy'
import { Dot } from '@renderer/ui/components/dot'
import { cn } from '@renderer/ui/lib/utils'
import type { Tone } from '@renderer/ui/lib/types'
import { TONE_BG, TONE_TEXT } from '@renderer/ui/lib/tones'

import { POD_STATUS } from '../data/static'
import type { Pod } from '../types'

const col = createColumnHelper<Pod>()

/** Per-container square colour (Lens-style): ready→green, completed→grey,
 *  crash/error→red, otherwise (waiting/creating)→amber. */
function containerTone(c: Pod['containers'][number]): Tone {
  if (c.ready) return 'success'
  if (c.state === 'Completed') return 'dim'
  if (/Error|CrashLoop|BackOff|OOM|Terminated|Evicted|Failed/i.test(c.state)) return 'destructive'
  return 'warning'
}

export const podColumns = [
  col.accessor('name', {
    header: 'NAME',
    size: 260,
    cell: (c) => <span className="text-foreground">{c.getValue()}</span>
  }),
  col.accessor('ns', {
    header: 'NAMESPACE',
    size: 150,
    meta: { cellClassName: 'text-muted-foreground' }
  }),
  col.accessor('status', {
    header: 'STATUS',
    size: 120,
    cell: (c) => {
      const status = c.getValue()
      const tone = POD_STATUS[status] ?? 'dim'
      return (
        <span className={cn('inline-flex items-center gap-1.5', TONE_TEXT[tone])}>
          <Dot tone={tone} pulse={status === 'Running'} />
          {status}
        </span>
      )
    }
  }),
  col.accessor('containers', {
    header: 'CONTAINER',
    size: 110,
    enableSorting: false,
    cell: (c) => {
      const cs = c.getValue()
      const ready = cs.filter((x) => x.ready).length
      return (
        <span className="inline-flex items-center gap-1" title={`${ready}/${cs.length} ready`}>
          {cs.map((x) => (
            <span
              key={x.name}
              title={`${x.name} · ${x.state}${x.ready ? ' · ready' : ''}`}
              className={cn('inline-block h-2.5 w-2.5 rounded-[2px]', TONE_BG[containerTone(x)])}
            />
          ))}
        </span>
      )
    }
  }),
  col.accessor('restarts', {
    header: 'RESTARTS',
    size: 90,
    meta: { align: 'right', cellClassName: 'tabular-nums' },
    cell: (c) => {
      const r = c.getValue()
      return (
        <span className={r > 3 ? 'text-destructive' : r > 0 ? 'text-warning' : 'text-dim'}>
          {r}
        </span>
      )
    }
  }),
  col.accessor('cpu', {
    header: 'CPU',
    size: 80,
    meta: { align: 'right', cellClassName: 'tabular-nums text-muted-foreground' }
  }),
  col.accessor('mem', {
    header: 'MEM',
    size: 80,
    meta: { align: 'right', cellClassName: 'tabular-nums text-muted-foreground' }
  }),
  col.accessor('node', {
    header: 'NODE',
    size: 200,
    meta: { cellClassName: 'text-dim' }
  }),
  col.accessor('age', {
    header: 'AGE',
    size: 70,
    meta: { cellClassName: 'text-faint' }
  })
]
