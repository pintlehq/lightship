import { Icon } from '@renderer/ui/components/icon'
import { cn } from '@renderer/ui/lib/utils'

/** Floating word-wrap toggle, positioned at the top-right of a `relative` editor area. */
export function WrapToggle({ wrap, onToggle }: { wrap: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title="Toggle word wrap"
      aria-pressed={wrap}
      className={cn(
        'absolute right-2 top-2 z-20 inline-flex h-6 items-center gap-1 rounded border px-1.5 font-mono text-2xs shadow-sm transition-colors',
        wrap
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-card/90 text-muted-foreground hover:bg-hover hover:text-foreground'
      )}
    >
      <Icon name="code" className="h-3 w-3" />
      Wrap
    </button>
  )
}
