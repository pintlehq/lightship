import * as React from 'react'

import { cn } from '@renderer/ui/lib/utils'
import type { PaletteGroup, PaletteItem } from '@renderer/ui/lib/types'
import { Icon } from '@renderer/ui/components/icon'
import { Kbd } from '@renderer/ui/components/kbd'
import { Overlay } from '@renderer/ui/components/overlay'

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  placeholder?: string
  groups: PaletteGroup[]
  prefix?: string
}

export function CommandPalette({
  open,
  onClose,
  placeholder,
  groups,
  prefix = '›'
}: CommandPaletteProps) {
  const [q, setQ] = React.useState('')
  const [active, setActive] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!open) return
    setQ('')
    setActive(0)
    const t = setTimeout(() => inputRef.current?.focus(), 20)
    return () => clearTimeout(t)
  }, [open])

  if (!open) return null

  const flat: PaletteItem[] = []
  const filtered = groups
    .map((g) => {
      const items = g.items.filter(
        (it) =>
          !q ||
          it.label.toLowerCase().includes(q.toLowerCase()) ||
          (it.hint ?? '').toLowerCase().includes(q.toLowerCase())
      )
      items.forEach((it) => flat.push(it))
      return { ...g, items }
    })
    .filter((g) => g.items.length)

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const it = flat[active]
      if (it) {
        it.onSelect?.()
        onClose()
      }
    }
  }

  let idx = -1
  return (
    <Overlay open={open} onClose={onClose} align="top">
      <div className="w-[640px] max-w-[92vw] overflow-hidden rounded-xl border border-border-strong bg-popover font-mono shadow-lg">
        <div className="flex h-12 items-center gap-2.5 border-b border-border px-3.5">
          <span className="text-[15px] font-semibold text-primary">{prefix}</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKey}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-faint"
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="max-h-[360px] overflow-y-auto py-1.5">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-dim">No matches</div>
          )}
          {filtered.map((g, gi) => (
            <div key={gi}>
              <div className="px-3.5 pb-1 pt-2 text-[10px] uppercase tracking-[0.12em] text-faint">
                {g.group}
              </div>
              {g.items.map((it) => {
                idx++
                const at = idx
                const isActive = at === active
                return (
                  <button
                    key={it.label}
                    type="button"
                    onMouseEnter={() => setActive(at)}
                    onClick={() => {
                      it.onSelect?.()
                      onClose()
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 px-3.5 py-1.5 text-left text-[13px] transition-colors',
                      isActive
                        ? 'bg-primary/12 text-foreground'
                        : 'text-muted-foreground hover:bg-hover'
                    )}
                  >
                    <Icon
                      name={it.icon ?? 'arrowRight'}
                      className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-dim')}
                    />
                    <span className="flex-1 text-foreground">{it.label}</span>
                    {it.hint && <span className="text-xs text-faint">{it.hint}</span>}
                    {it.kbd && (
                      <span className="flex gap-1">
                        {it.kbd.map((k, i) => (
                          <Kbd key={i}>{k}</Kbd>
                        ))}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </Overlay>
  )
}
