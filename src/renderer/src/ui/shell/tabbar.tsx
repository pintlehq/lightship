import { useRef, useState, type DragEvent } from 'react'

import { cn } from '@renderer/ui/lib/utils'
import { Icon, type IconName } from '@renderer/ui/components/icon'
import { ContextMenu, type ContextMenuItemDef } from '@renderer/ui/components/context-menu'
import type { TabbarAction, TabbarReorderPlacement } from '@renderer/ui/lib/types'

export interface TabbarTab {
  id: string
  label: string
  icon?: IconName
  iconClass?: string
  dirty?: boolean
}

export interface TabbarProps {
  tabs: TabbarTab[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose?: (id: string) => void
  onCloseOthers?: (id: string) => void
  onCloseToRight?: (id: string) => void
  onCloseAll?: () => void
  onNew?: () => void
  onReorder?: (draggedId: string, targetId: string, placement: TabbarReorderPlacement) => void
  actions?: TabbarAction[]
  /** Visual style. `tabs` (default) = card tabs for the main view; `panel` =
   *  VS Code–style text tabs with an underline, for the bottom panel. */
  variant?: 'tabs' | 'panel'
}

interface DropTarget {
  id: string
  placement: TabbarReorderPlacement
}

export function Tabbar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onNew,
  onReorder,
  actions,
  variant = 'tabs'
}: TabbarProps) {
  const panel = variant === 'panel'
  const reorderEnabled = !!onReorder && tabs.length > 1
  const draggedId = useRef<string | null>(null)
  const suppressClick = useRef(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  const clearDragState = () => {
    draggedId.current = null
    setDraggingId(null)
    setDropTarget(null)
  }

  const placementForEvent = (e: DragEvent<HTMLElement>): TabbarReorderPlacement => {
    const rect = e.currentTarget.getBoundingClientRect()
    return e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
  }

  const finishDrag = () => {
    clearDragState()
    window.setTimeout(() => {
      suppressClick.current = false
    }, 0)
  }

  return (
    <div
      className={cn(
        'no-scrollbar flex h-9 items-stretch overflow-x-auto border-b border-border bg-chrome',
        panel && 'px-1'
      )}
    >
      {tabs.map((t, i) => {
        const active = t.id === activeId
        const menuItems: ContextMenuItemDef[] = [
          { label: 'Close', kbd: '⌘W', onSelect: () => onClose?.(t.id) },
          {
            label: 'Close Others',
            disabled: tabs.length <= 1,
            onSelect: () => onCloseOthers?.(t.id)
          },
          {
            label: 'Close to the Right',
            disabled: i >= tabs.length - 1,
            onSelect: () => onCloseToRight?.(t.id)
          },
          { label: 'Close All', separatorBefore: true, onSelect: () => onCloseAll?.() }
        ]
        return (
          <ContextMenu key={t.id} items={menuItems}>
            <div
              data-tab-id={t.id}
              draggable={reorderEnabled}
              onDragStart={(e) => {
                if (!reorderEnabled) return
                draggedId.current = t.id
                suppressClick.current = true
                setDraggingId(t.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', t.id)
              }}
              onDragOver={(e) => {
                const sourceId = draggedId.current
                if (!reorderEnabled || !sourceId || sourceId === t.id) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                const placement = placementForEvent(e)
                setDropTarget((current) =>
                  current?.id === t.id && current.placement === placement
                    ? current
                    : { id: t.id, placement }
                )
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
                setDropTarget((current) => (current?.id === t.id ? null : current))
              }}
              onDrop={(e) => {
                const sourceId = draggedId.current
                if (!reorderEnabled || !sourceId || sourceId === t.id) return
                e.preventDefault()
                onReorder?.(
                  sourceId,
                  t.id,
                  dropTarget?.id === t.id ? dropTarget.placement : placementForEvent(e)
                )
                finishDrag()
              }}
              onDragEnd={finishDrag}
              onClick={(e) => {
                if (suppressClick.current) {
                  e.stopPropagation()
                  suppressClick.current = false
                  return
                }
                onSelect(t.id)
              }}
              className={cn(
                'group relative flex cursor-pointer select-none items-center gap-2 whitespace-nowrap px-3 font-mono transition-colors',
                reorderEnabled && 'cursor-grab active:cursor-grabbing',
                draggingId === t.id && 'opacity-45',
                panel
                  ? cn(
                      'gap-1.5 text-[11px] uppercase tracking-[0.06em]',
                      active ? 'text-foreground' : 'text-dim hover:text-foreground'
                    )
                  : cn(
                      'border-r border-border/60 text-[13px]',
                      active
                        ? 'bg-card text-foreground'
                        : 'bg-chrome text-muted-foreground hover:text-foreground'
                    )
              )}
            >
              {dropTarget?.id === t.id && (
                <span
                  className={cn(
                    'pointer-events-none absolute inset-y-1 w-[2px] rounded-full bg-primary',
                    dropTarget.placement === 'before' ? 'left-0' : 'right-0'
                  )}
                />
              )}
              {active &&
                (panel ? (
                  <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-primary" />
                ) : (
                  <span className="absolute inset-x-0 top-0 h-[1.5px] bg-primary" />
                ))}
              {t.icon && <Icon name={t.icon} className={cn('h-3.5 w-3.5', t.iconClass)} />}
              <span>{t.label}</span>
              <button
                type="button"
                draggable={false}
                aria-label={`Close ${t.label}`}
                onDragStart={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose?.(t.id)
                }}
                className={cn(
                  'relative grid h-[18px] w-[18px] place-items-center rounded transition-opacity hover:bg-hover',
                  active && !panel ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}
              >
                {t.dirty ? (
                  <span className="h-[7px] w-[7px] rounded-full bg-primary group-hover:hidden" />
                ) : null}
                <Icon
                  name="x"
                  className={cn('h-3 w-3', t.dirty && 'hidden group-hover:block')}
                  weight="bold"
                />
              </button>
            </div>
          </ContextMenu>
        )
      })}
      <div className="flex-1 border-r border-border/60 bg-chrome" />
      {onNew && (
        <button
          type="button"
          onClick={onNew}
          className="grid w-9 place-items-center border-r border-border/60 text-dim transition-colors hover:bg-hover hover:text-foreground"
        >
          <Icon name="plus" className="h-4 w-4" />
        </button>
      )}
      {(actions ?? []).map((a, i) => (
        <button
          key={i}
          type="button"
          onClick={a.onClick}
          title={a.label}
          className={cn(
            'grid w-9 place-items-center border-r border-border/60 transition-colors hover:bg-hover',
            a.active ? 'text-primary' : 'text-dim hover:text-foreground'
          )}
        >
          <Icon name={a.icon} className="h-4 w-4" />
        </button>
      ))}
    </div>
  )
}
