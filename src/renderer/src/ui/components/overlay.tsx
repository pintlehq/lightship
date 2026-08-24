import * as React from 'react'
import { Dialog } from '@base-ui/react/dialog'

import { cn } from '@renderer/ui/lib/utils'

export interface OverlayProps {
  /** Controlled open state (defaults open when rendered). */
  open?: boolean
  onClose?: () => void
  align?: 'center' | 'top'
  children: React.ReactNode
  /** Extra classes for the positioned popup. */
  className?: string
}

/**
 * Modal overlay built on Base UI Dialog — backdrop blur, esc / outside-press to
 * close, focus trap. The animation lives on an inner wrapper so it doesn't fight
 * the centering transform on the popup.
 */
function Overlay({ open = true, onClose, align = 'center', children, className }: OverlayProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose?.()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[150] bg-black/45 backdrop-blur-[2px] animate-overlay-in" />
        <Dialog.Popup
          className={cn(
            'fixed left-1/2 z-[150] -translate-x-1/2 outline-none',
            align === 'top' ? 'top-24' : 'top-1/2 -translate-y-1/2',
            className
          )}
        >
          <div className="animate-pop-in">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export { Overlay }
