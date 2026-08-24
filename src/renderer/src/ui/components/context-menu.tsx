import { Fragment } from 'react'
import type { ElementType, ReactElement, ReactNode } from 'react'
import { ContextMenu as CtxMenu } from '@base-ui/react/context-menu'

import { cn } from '@renderer/ui/lib/utils'
import { Icon } from './icon'

export interface ContextMenuItemDef {
  label: string
  onSelect?: () => void
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
  kbd?: string
  /** When present, the item opens a nested submenu instead of firing onSelect. */
  submenu?: ContextMenuItemDef[]
}

export interface ContextMenuProps {
  /** The element that opens the menu on right-click. */
  children: ReactElement
  items: ContextMenuItemDef[]
}

const POPUP_CLASS =
  'min-w-[180px] rounded-lg border border-border-strong bg-popover p-1 font-mono text-[13px] shadow-lg outline-none animate-pop-in'

const itemClass = (it: ContextMenuItemDef): string =>
  cn(
    'flex cursor-default items-center justify-between gap-6 rounded px-2.5 py-1.5 outline-none transition-colors',
    'data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[popup-open]:bg-hover',
    it.danger ? 'text-destructive data-[highlighted]:bg-destructive/10' : 'text-foreground'
  )

/** The Base UI parts shared by `Menu` and `ContextMenu` (same part names). */
export interface MenuParts {
  Item: ElementType
  Separator: ElementType
  SubmenuRoot: ElementType
  SubmenuTrigger: ElementType
  Portal: ElementType
  Positioner: ElementType
  Popup: ElementType
}

/** Render a flat-or-nested item list with the given Base UI menu parts. Shared by
 *  `ContextMenu` (right-click) and `ActionMenu` (kebab). */
export function renderMenuItems(p: MenuParts, items: ContextMenuItemDef[]): ReactNode {
  return items.map((it, i) => (
    <Fragment key={i}>
      {it.separatorBefore && <p.Separator className="my-1 h-px bg-border" />}
      {it.submenu ? (
        <p.SubmenuRoot>
          <p.SubmenuTrigger className={itemClass(it)}>
            <span>{it.label}</span>
            <Icon name="arrowRight" className="h-3.5 w-3.5 text-faint" />
          </p.SubmenuTrigger>
          <p.Portal>
            <p.Positioner
              side="right"
              align="start"
              sideOffset={4}
              className="z-[200] outline-none"
            >
              <p.Popup className={POPUP_CLASS}>{renderMenuItems(p, it.submenu)}</p.Popup>
            </p.Positioner>
          </p.Portal>
        </p.SubmenuRoot>
      ) : (
        <p.Item disabled={it.disabled} onClick={() => it.onSelect?.()} className={itemClass(it)}>
          <span>{it.label}</span>
          {it.kbd && <span className="text-[11px] text-faint">{it.kbd}</span>}
        </p.Item>
      )}
    </Fragment>
  ))
}

/** Right-click menu on Base UI's ContextMenu, styled to the design tokens. */
export function ContextMenu({ children, items }: ContextMenuProps) {
  return (
    <CtxMenu.Root>
      <CtxMenu.Trigger render={children} />
      <CtxMenu.Portal>
        <CtxMenu.Positioner className="z-[200] outline-none">
          <CtxMenu.Popup className={POPUP_CLASS}>
            {renderMenuItems(CtxMenu as unknown as MenuParts, items)}
          </CtxMenu.Popup>
        </CtxMenu.Positioner>
      </CtxMenu.Portal>
    </CtxMenu.Root>
  )
}
