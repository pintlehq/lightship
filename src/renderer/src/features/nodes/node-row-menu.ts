import type { ContextMenuItemDef } from '@renderer/ui/components/context-menu'

export interface NodeRowMenuOpts {
  /** Node is currently cordoned (spec.unschedulable). */
  cordoned: boolean
  /** Read-only mode — gates the mutating items, like the bulk bar. */
  readOnly: boolean
  onCordon: () => void
  onUncordon: () => void
  onDrain: () => void
}

/** The per-row menu for a node — context-aware like the bulk bar: Cordon when
 *  schedulable, Uncordon when cordoned, Drain always. Shared by the kebab and the
 *  right-click context menu. */
export function buildNodeRowMenu(opts: NodeRowMenuOpts): ContextMenuItemDef[] {
  const items: ContextMenuItemDef[] = []
  if (!opts.cordoned)
    items.push({ label: 'Cordon', disabled: opts.readOnly, onSelect: opts.onCordon })
  if (opts.cordoned)
    items.push({ label: 'Uncordon', disabled: opts.readOnly, onSelect: opts.onUncordon })
  items.push({
    label: 'Drain',
    danger: true,
    separatorBefore: true,
    disabled: opts.readOnly,
    onSelect: opts.onDrain
  })
  return items
}
