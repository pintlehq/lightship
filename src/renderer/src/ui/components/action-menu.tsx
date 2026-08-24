import { Menu } from '@base-ui/react/menu'

import { cn } from '@renderer/ui/lib/utils'
import { Icon, type IconName } from './icon'
import { renderMenuItems, type ContextMenuItemDef, type MenuParts } from './context-menu'

export interface ActionMenuProps {
  items: ContextMenuItemDef[]
  /** Accessible label for the trigger. */
  label?: string
  /** Trigger glyph (defaults to the kebab ⋮). */
  icon?: IconName
  className?: string
}

/** Click-triggered kebab (⋮) menu — the left-click sibling of `ContextMenu`,
 *  sharing its item shape, styling, and submenu support. Built on Base UI's Menu.
 *  Pass `icon` to swap the trigger glyph (e.g. a download button). */
export function ActionMenu({
  items,
  label = 'Row actions',
  icon = 'more',
  className
}: ActionMenuProps) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        className={cn(
          'grid h-6 w-6 cursor-pointer place-items-center rounded text-dim outline-none transition-colors',
          'hover:bg-active hover:text-foreground hover:ring-1 hover:ring-inset hover:ring-border-strong',
          'data-[popup-open]:bg-active data-[popup-open]:text-foreground data-[popup-open]:ring-1 data-[popup-open]:ring-inset data-[popup-open]:ring-border-strong',
          className
        )}
      >
        <Icon name={icon} className="h-4 w-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          className="z-[200] outline-none"
        >
          <Menu.Popup className="min-w-[180px] rounded-lg border border-border-strong bg-popover p-1 font-mono text-[13px] shadow-lg outline-none animate-pop-in">
            {renderMenuItems(Menu as unknown as MenuParts, items)}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
