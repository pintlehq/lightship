import { cn } from '@renderer/ui/lib/utils'

export interface ProgressProps {
  value: number
  max?: number
  className?: string
}

/** A thin determinate progress bar with a primary fill on a muted track. */
export function Progress({ value, max = 100, className }: ProgressProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
