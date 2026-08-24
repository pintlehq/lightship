import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@renderer/ui/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-2xs font-mono font-medium leading-5',
  {
    variants: {
      variant: {
        default: 'border-primary/25 bg-primary/12 text-primary',
        secondary: 'border-border bg-muted text-muted-foreground',
        outline: 'border-border bg-transparent text-muted-foreground',
        success: 'border-success/30 bg-success/10 text-success',
        warning: 'border-warning/30 bg-warning/10 text-warning',
        info: 'border-info/30 bg-info/10 text-info',
        destructive: 'border-destructive/30 bg-destructive/10 text-destructive'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
