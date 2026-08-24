import type { ContextMenuItemDef } from '@renderer/ui/components/context-menu'

export interface PodRowMenuOpts {
  /** The pod's container names — drive the Logs/Exec submenus. */
  containers: string[]
  /** Read-only mode — gates the mutating item (Delete), like the bulk bar. */
  readOnly: boolean
  onOpen: () => void
  /** `undefined` = all containers (logs only). */
  onLogs: (container?: string) => void
  onExec: (container?: string) => void
  onDelete: () => void
}

/** The per-row menu for a pod. Logs/Exec become submenus when the pod has more
 *  than one container (e.g. app + sidecar); single-container pods stay flat.
 *  Shared by the kebab (ActionMenu) and the right-click context menu. */
export function buildPodRowMenu(opts: PodRowMenuOpts): ContextMenuItemDef[] {
  const { containers, onLogs, onExec } = opts
  const multi = containers.length > 1

  const logs: ContextMenuItemDef = multi
    ? {
        label: 'Logs',
        submenu: [
          { label: 'All containers', onSelect: () => onLogs() },
          ...containers.map((c) => ({ label: c, onSelect: () => onLogs(c) }))
        ]
      }
    : { label: 'Logs', onSelect: () => onLogs(containers[0]) }

  const exec: ContextMenuItemDef = multi
    ? { label: 'Exec', submenu: containers.map((c) => ({ label: c, onSelect: () => onExec(c) })) }
    : { label: 'Exec', onSelect: () => onExec(containers[0]) }

  return [
    { label: 'Open', onSelect: opts.onOpen },
    logs,
    exec,
    {
      label: 'Delete',
      danger: true,
      separatorBefore: true,
      disabled: opts.readOnly,
      onSelect: opts.onDelete
    }
  ]
}
