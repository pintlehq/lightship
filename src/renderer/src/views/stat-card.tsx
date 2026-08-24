import { Card } from '@renderer/ui/components/card'
import { cn } from '@renderer/ui/lib/utils'

export interface StatCardProps {
  label: string
  value: string | number
  unit?: string
  sub?: string
  subTone?: 'up' | 'down'
  bar?: number
  barTone?: 'warning' | 'destructive'
  spark?: number[]
}

export function StatCard({ label, value, unit, sub, subTone, bar, barTone, spark }: StatCardProps) {
  return (
    <Card className="p-4">
      <h3 className="mb-1 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-dim">
        {label}
      </h3>
      <div className="font-mono text-[26px] font-medium leading-none tabular-nums text-foreground">
        {value}
        {unit && <span className="ml-1 text-sm text-dim">{unit}</span>}
      </div>
      {sub && (
        <div
          className={cn(
            'mt-1.5 font-mono text-[11px]',
            subTone === 'up' ? 'text-destructive' : subTone === 'down' ? 'text-success' : 'text-dim'
          )}
        >
          {sub}
        </div>
      )}
      {bar != null && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted">
          <span
            className={cn(
              'block h-full rounded-full',
              barTone === 'warning'
                ? 'bg-warning'
                : barTone === 'destructive'
                  ? 'bg-destructive'
                  : 'bg-primary'
            )}
            style={{ width: `${bar}%` }}
          />
        </div>
      )}
      {spark && (
        <div className="mt-2.5 flex h-8 items-end gap-0.5">
          {spark.map((h, i) => (
            <span
              key={i}
              className="min-w-[2px] flex-1 border-t-2 border-primary bg-primary/15"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      )}
    </Card>
  )
}
