import { Badge } from '@renderer/ui/components/badge'

import type { ClusterEvent } from '../../../shared/ipc-types'
import { eventTone } from '../lib/event-tone'

/** Renders a list of cluster events (newest first), with an empty state. */
export function EventList({ events }: { events: ClusterEvent[] }) {
  if (events.length === 0) {
    return <div className="py-4 text-center font-mono text-[11.5px] text-dim">No events</div>
  }
  return (
    <div className="space-y-1">
      {events.map((e, i) => (
        <div
          key={i}
          className="flex items-baseline gap-3 border-b border-border/60 py-2 font-mono text-[12px] last:border-0"
        >
          <Badge variant={eventTone(e)}>{e.type}</Badge>
          <span className="text-foreground">{e.reason}</span>
          <span className="flex-1 truncate text-dim" title={e.message}>
            {e.message}
          </span>
          <span className="text-faint">{e.age}</span>
        </div>
      ))}
    </div>
  )
}
