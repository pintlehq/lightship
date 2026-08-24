import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@renderer/ui/lib/utils'

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center font-mono font-medium whitespace-nowrap transition-colors outline-none select-none ring-focus disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        secondary: 'border border-border bg-secondary text-secondary-foreground hover:bg-hover',
        outline:
          'border border-border bg-transparent text-foreground hover:border-border-strong hover:bg-hover',
        ghost: 'bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground',
        destructive:
          'border border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10',
        link: 'bg-transparent text-primary underline-offset-4 hover:underline'
      },
      size: {
        sm: 'h-7 gap-1.5 rounded-md px-2.5 text-xs',
        default: 'h-8 gap-2 rounded-md px-3 text-[13px]',
        lg: 'h-9 gap-2 rounded-md px-4 text-sm',
        icon: 'h-7 w-7 rounded-md',
        'icon-sm': 'h-6 w-6 rounded'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant,
  size,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
