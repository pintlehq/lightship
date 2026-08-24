import type { ContextMenuItemDef } from '@renderer/ui/components/context-menu'

export interface ResourceRowMenuOpts {
  /** Kind owns pods, so its logs can be streamed (deployments/statefulsets/…). */
  loggable: boolean
  /** Kind supports a rolling restart (deployments/statefulsets/daemonsets). */
  restartable: boolean
  /** Kind supports setting spec.replicas (deployments/statefulsets). */
  scalable: boolean
  /** Read-only mode — gates the mutating items, like the bulk bar. */
  readOnly: boolean
  onOpen: () => void
  onLogs: () => void
  onRestart: () => void
  onScale: () => void
  onDelete: () => void
}

/** The per-row menu for a resource row — feature-driven like the bulk bar:
 *  Open always; Logs only for loggable (pod-owning) kinds; Rolling restart only
 *  for restartable kinds; Scale only for scalable workloads; Delete always. Logs is a read action so it stays
 *  enabled in read-only mode. Shared by the kebab + right-click context menu. */
export function buildResourceRowMenu(opts: ResourceRowMenuOpts): ContextMenuItemDef[] {
  const items: ContextMenuItemDef[] = [{ label: 'Open', onSelect: opts.onOpen }]
  if (opts.loggable) {
    items.push({ label: 'Logs', onSelect: opts.onLogs })
  }
  if (opts.scalable) {
    items.push({ label: 'Scale', disabled: opts.readOnly, onSelect: opts.onScale })
  }
  if (opts.restartable) {
    items.push({ label: 'Rolling restart', disabled: opts.readOnly, onSelect: opts.onRestart })
  }
  items.push({
    label: 'Delete',
    danger: true,
    separatorBefore: true,
    disabled: opts.readOnly,
    onSelect: opts.onDelete
  })
  return items
}
