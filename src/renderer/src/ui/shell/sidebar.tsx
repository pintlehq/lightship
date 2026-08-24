import * as React from 'react'

import { cn } from '@renderer/ui/lib/utils'
import type { SidebarAction, Tone } from '@renderer/ui/lib/types'
import { Icon, type IconName } from '@renderer/ui/components/icon'
import { Dot } from '@renderer/ui/components/dot'
import { Tooltip } from '@renderer/ui/components/tooltip'

export interface SidebarProps {
  title: string
  actions?: SidebarAction[]
  search?: string
  onSearch?: (value: string) => void
  searchPlaceholder?: string
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number
  /** When provided, a right-edge handle lets the user drag-resize the width. */
  onResize?: (width: number) => void
}

export function Sidebar({
  title,
  actions,
  search,
  onSearch,
  searchPlaceholder,
  children,
  footer,
  width = 280,
  onResize
}: SidebarProps) {
  // Fall back to internal state when the app doesn't wire filtering, so the
  // search box still accepts input.
  const [internal, setInternal] = React.useState('')
  const value = search ?? internal
  const handleSearch = (next: string) => (onSearch ? onSearch(next) : setInternal(next))

  const drag = React.useRef<{ startX: number; startWidth: number } | null>(null)
  const onHandleDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startWidth: width }
  }
  const onHandleMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const next = drag.current.startWidth + (e.clientX - drag.current.startX)
    const max = Math.min(Math.round(window.innerWidth * 0.5), 600)
    onResize?.(Math.max(200, Math.min(max, next)))
  }
  const onHandleUp = (e: React.PointerEvent) => {
    drag.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return (
    <aside
      className="relative flex min-h-0 flex-col overflow-hidden border-r border-border bg-chrome"
      style={{ width }}
    >
      {onResize && (
        <div
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          className="absolute inset-y-0 right-0 z-20 w-1 cursor-col-resize hover:bg-primary/40"
        />
      )}
      <div className="flex h-9 items-center justify-between border-b border-border/70 px-3">
        <span className="font-mono text-2xs uppercase tracking-[0.12em] text-dim">{title}</span>
        <div className="flex items-center gap-0.5">
          {(actions ?? []).map((a, i) => (
            <Tooltip key={i} label={a.label}>
              <button
                type="button"
                onClick={a.onClick}
                aria-label={typeof a.label === 'string' ? a.label : undefined}
                className="grid h-[22px] w-[22px] place-items-center rounded text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
              >
                <Icon name={a.icon} className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          ))}
        </div>
      </div>
      <div className="border-b border-border/70 p-2">
        <div className="relative">
          <Icon
            name="search"
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
          />
          <input
            value={value}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-7 w-full rounded-md border border-input bg-background pl-8 pr-2.5 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-faint focus:border-primary focus:ring-2 focus:ring-ring/30"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1 font-mono text-[12.5px]">{children}</div>
      {footer && <div className="border-t border-border/70 p-2">{footer}</div>}
    </aside>
  )
}

export interface TreeRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  depth?: number
  icon?: IconName
  iconClass?: string
  label: React.ReactNode
  count?: number | null
  active?: boolean
  caret?: boolean
  onToggle?: () => void
  onClick?: React.MouseEventHandler<HTMLDivElement>
  onDoubleClick?: React.MouseEventHandler<HTMLDivElement>
  trailing?: React.ReactNode
  leadingHealth?: Tone
  labelClassName?: string
}

export const TreeRow = React.forwardRef<HTMLDivElement, TreeRowProps>(function TreeRow(
  {
    depth = 0,
    icon,
    iconClass,
    label,
    count,
    active,
    caret,
    onToggle,
    onClick,
    onDoubleClick,
    trailing,
    leadingHealth,
    className,
    labelClassName,
    style,
    ...props
  },
  ref
) {
  return (
    <div
      {...props}
      ref={ref}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        'group relative flex h-[26px] cursor-pointer items-center gap-1.5 whitespace-nowrap pr-3 transition-colors',
        active
          ? 'bg-active text-foreground'
          : 'text-muted-foreground hover:bg-hover hover:text-foreground',
        className
      )}
      style={{ ...style, paddingLeft: 8 + depth * 12 }}
    >
      {active && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
      {caret !== undefined ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggle?.()
          }}
          className="grid w-3.5 place-items-center text-faint hover:text-foreground"
        >
          <Icon name={caret ? 'chevronDown' : 'chevronRight'} className="h-3 w-3" weight="bold" />
        </button>
      ) : (
        <span className="w-3.5" />
      )}
      {leadingHealth && <Dot tone={leadingHealth} pulse className="mr-0.5" />}
      {icon && <Icon name={icon} className={cn('h-3.5 w-3.5 shrink-0 opacity-85', iconClass)} />}
      <span className={cn('truncate', labelClassName)}>{label}</span>
      {trailing}
      {count != null && (
        <span className="ml-auto rounded-full bg-muted px-1.5 text-[10.5px] leading-[15px] text-faint">
          {count}
        </span>
      )}
    </div>
  )
})

export function TreeSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-1 pt-3 font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint">
      {children}
    </div>
  )
}
