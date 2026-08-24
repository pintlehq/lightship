import { Popover } from '@base-ui/react/popover'

import { cn } from '@renderer/ui/lib/utils'
import type { Tone } from '@renderer/ui/lib/types'
import { Checkbox } from './checkbox'
import { Dot } from './dot'
import { Icon, type IconName } from './icon'

export interface MultiSelectOption {
  value: string
  count?: number
  tone?: Tone
}

export interface MultiSelectProps {
  label: string
  icon?: IconName
  options: Array<string | MultiSelectOption>
  selected: string[]
  onChange: (next: string[]) => void
  allLabel?: string
  width?: string
}

function MultiSelect({
  label,
  icon = 'filter',
  options,
  selected,
  onChange,
  allLabel = 'all',
  width = 'w-56'
}: MultiSelectProps) {
  const norm: MultiSelectOption[] = options.map((o) => (typeof o === 'string' ? { value: o } : o))
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((x) => x !== value) : [...selected, value])
  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`

  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          'group inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 font-mono text-[13px] transition-colors ring-focus',
          selected.length
            ? 'border-primary/60 bg-accent text-foreground'
            : 'border-border bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground'
        )}
      >
        <Icon name={icon} className="h-3.5 w-3.5" />
        {label}: <span className="text-foreground">{summary}</span>
        {selected.length > 0 && (
          <span className="grid h-4 min-w-[16px] place-items-center rounded-full bg-primary px-1 text-[9px] font-semibold tabular-nums text-primary-foreground">
            {selected.length}
          </span>
        )}
        <Icon
          name="chevronDown"
          className="h-3 w-3 text-faint transition-transform group-data-[popup-open]:rotate-180"
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-[200]">
          <Popover.Popup
            className={cn(
              'overflow-hidden rounded-lg border border-border-strong bg-popover shadow-lg animate-pop-in',
              width
            )}
          >
            <div className="flex h-8 items-center justify-between border-b border-border bg-chrome px-3">
              <span className="font-mono text-2xs uppercase tracking-[0.08em] text-dim">
                {label}
              </span>
              {selected.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="font-mono text-[11px] text-primary hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {norm.map((opt) => {
                const on = selected.includes(opt.value)
                return (
                  <label
                    key={opt.value}
                    className="flex h-8 cursor-pointer items-center gap-2.5 px-3 hover:bg-hover"
                  >
                    <Checkbox checked={on} onChange={() => toggle(opt.value)} />
                    {opt.tone && <Dot tone={opt.tone} />}
                    <span className="flex-1 truncate font-mono text-[12.5px] text-foreground">
                      {opt.value}
                    </span>
                    {opt.count != null && (
                      <span className="font-mono text-[10.5px] tabular-nums text-faint">
                        {opt.count}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

export { MultiSelect }
