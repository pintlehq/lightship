import { Switch as SwitchPrimitive } from '@base-ui/react/switch'

import { cn } from '@renderer/ui/lib/utils'

export interface SwitchProps {
  checked?: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

function Switch({ checked, onChange, disabled, className }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      disabled={disabled}
      onCheckedChange={(value) => onChange?.(value)}
      className={cn(
        'relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors ring-focus',
        'data-checked:bg-primary data-unchecked:border data-unchecked:border-border data-unchecked:bg-input',
        className
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'inline-block h-3 w-3 rounded-full bg-background shadow-sm transition-transform',
          'data-checked:translate-x-[15px] data-unchecked:translate-x-[3px]'
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
