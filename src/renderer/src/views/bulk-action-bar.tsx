import { Button } from '@renderer/ui/components/button'
import { Icon, type IconName } from '@renderer/ui/components/icon'
import { Separator } from '@renderer/ui/components/separator'

export interface BulkAction {
  label: string
  icon: IconName
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

/** Floating panel anchored to the center-bottom of the content/tab area
 *  (the AppShell content region is `relative`, so this absolute bar centers
 *  within the active tab, not the whole window). */
export function BulkActionBar({
  count,
  actions,
  onClear
}: {
  count: number
  actions: BulkAction[]
  onClear: () => void
}) {
  if (count === 0) return null
  return (
    <div className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border-strong bg-popover px-2 py-1.5 font-mono text-xs shadow-lg animate-pop-in">
      <span className="px-2 font-semibold text-primary">{count} selected</span>
      <Separator orientation="vertical" />
      {actions.map((a) => (
        <Button
          key={a.label}
          variant={a.danger ? 'destructive' : 'ghost'}
          size="sm"
          disabled={a.disabled}
          onClick={a.onClick}
        >
          <Icon name={a.icon} className="h-3.5 w-3.5" />
          {a.label}
        </Button>
      ))}
      <Separator orientation="vertical" />
      <button
        type="button"
        onClick={onClear}
        title="Clear selection"
        className="grid h-6 w-6 place-items-center rounded text-dim hover:bg-hover hover:text-foreground"
      >
        <Icon name="x" className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
