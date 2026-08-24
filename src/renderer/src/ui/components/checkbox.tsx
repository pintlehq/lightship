import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'

import { cn } from '@renderer/ui/lib/utils'
import { Icon } from './icon'

export interface CheckboxProps {
  checked?: boolean
  indeterminate?: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

function Checkbox({ checked, indeterminate, onChange, disabled, className }: CheckboxProps) {
  const on = checked || indeterminate
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      indeterminate={indeterminate}
      disabled={disabled}
      onCheckedChange={(value) => onChange?.(value)}
      // Stop the click bubbling so checkboxes inside clickable rows don't trigger row clicks.
      onClick={(event) => event.stopPropagation()}
      className={cn(
        'grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[4px] border transition-colors ring-focus',
        on
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border-strong bg-background hover:border-primary',
        className
      )}
    >
      {indeterminate ? (
        <span className="h-0.5 w-2 rounded-full bg-current" />
      ) : checked ? (
        <Icon name="check" className="h-3 w-3" weight="bold" />
      ) : null}
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
