import * as React from 'react'

import { cn } from '@renderer/ui/lib/utils'

export interface InputProps extends React.ComponentProps<'input'> {
  /** Use the mono font (default true, matching the design). */
  mono?: boolean
}

function Input({ className, mono = true, ...props }: InputProps) {
  return (
    <input
      data-slot="input"
      className={cn(
        'h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-faint focus:border-primary focus:ring-2 focus:ring-ring/35',
        mono && 'font-mono',
        className
      )}
      {...props}
    />
  )
}

export { Input }
