import { cn } from '@renderer/ui/lib/utils'
import { Icon, type IconName } from './icon'

export interface TabDef {
  value: string
  label: string
  icon?: IconName
  count?: number
}

export interface TabsProps {
  tabs: TabDef[]
  value: string
  onChange: (value: string) => void
  className?: string
  variant?: 'underline' | 'segment'
}

/**
 * Lightweight controlled tab toggle (panels are rendered by the parent based on
 * `value`). Plain buttons matching the design — supports an underline indicator
 * and a segmented variant.
 */
function Tabs({ tabs, value, onChange, className, variant = 'underline' }: TabsProps) {
  if (variant === 'segment') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.5',
          className
        )}
      >
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded px-3 font-mono text-xs transition-colors ring-focus',
              value === t.value
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.icon && <Icon name={t.icon} className="h-3.5 w-3.5" />}
            {t.label}
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className={cn('flex items-stretch gap-1', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cn(
            'relative inline-flex h-9 items-center gap-1.5 whitespace-nowrap px-3 font-mono text-[13px] transition-colors ring-focus',
            value === t.value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t.icon && <Icon name={t.icon} className="h-3.5 w-3.5" />}
          {t.label}
          {t.count != null && (
            <span className="ml-0.5 rounded-md bg-muted px-1.5 text-[10px] leading-4 text-dim">
              {t.count}
            </span>
          )}
          {value === t.value && (
            <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
          )}
        </button>
      ))}
    </div>
  )
}

export { Tabs }
