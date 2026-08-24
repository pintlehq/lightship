import { cn } from '@renderer/ui/lib/utils'

export function UsageBar({ pct }: { pct: number }) {
  const tone = pct >= 85 ? 'bg-destructive' : pct >= 70 ? 'bg-warning' : 'bg-primary'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <span className={cn('block h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span
        className={cn(
          'w-8 text-[11.5px] tabular-nums',
          pct >= 85 ? 'text-destructive' : pct >= 70 ? 'text-warning' : 'text-muted-foreground'
        )}
      >
        {pct}%
      </span>
    </div>
  )
}
