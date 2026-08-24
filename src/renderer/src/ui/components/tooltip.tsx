import * as React from 'react'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'

import { cn } from '@renderer/ui/lib/utils'

type Side = 'top' | 'bottom' | 'left' | 'right'

export interface TooltipProps {
  label: React.ReactNode
  side?: Side
  children: React.ReactElement
  className?: string
}

function Tooltip({ label, side = 'bottom', children, className }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delay={250} closeDelay={0}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger render={children} />
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner side={side} sideOffset={6}>
            <TooltipPrimitive.Popup
              className={cn(
                'z-[200] whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 font-mono text-2xs text-foreground shadow-md animate-pop-in',
                className
              )}
            >
              {label}
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}

export { Tooltip }
