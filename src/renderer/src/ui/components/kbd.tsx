import * as React from 'react'

import { cn } from '@renderer/ui/lib/utils'

function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-elevated px-1.5 font-mono text-[10.5px] leading-none text-faint',
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
