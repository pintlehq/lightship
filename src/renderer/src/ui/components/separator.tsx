import { Separator as SeparatorPrimitive } from '@base-ui/react/separator'

import { cn } from '@renderer/ui/lib/utils'

function Separator({ orientation = 'horizontal', className, ...props }: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'vertical' ? 'w-px self-stretch' : 'h-px w-full',
        className
      )}
      {...props}
    />
  )
}

export { Separator }
