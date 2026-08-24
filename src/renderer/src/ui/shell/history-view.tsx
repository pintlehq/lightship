import * as React from 'react'

import type { HistoryItem } from '@renderer/ui/lib/types'
import { cn } from '@renderer/ui/lib/utils'
import { Icon } from '@renderer/ui/components/icon'
import { Input } from '@renderer/ui/components/input'
import { Button } from '@renderer/ui/components/button'
import { Card } from '@renderer/ui/components/card'

export interface HistoryViewProps {
  items: HistoryItem[]
  /** Wires the Clear button (no-op when omitted). */
  onClear?: () => void
  /** Wires the Export button (no-op when omitted). */
  onExport?: () => void
  /** Extra filter controls rendered in the header, left of the search box. */
  extraFilters?: React.ReactNode
}

export function HistoryView({ items, onClear, onExport, extraFilters }: HistoryViewProps) {
  const [q, setQ] = React.useState('')
  const list = (items ?? []).filter(
    (it) =>
      !q ||
      it.label.toLowerCase().includes(q.toLowerCase()) ||
      (it.sub ?? '').toLowerCase().includes(q.toLowerCase())
  )
  const recent = list.filter((it) => /m$|^\d+m/.test(it.time) || it.time === 'now')
  const today = list.filter((it) => it.time.includes('h'))
  const earlier = list.filter((it) => it.time.includes('d'))
  const groups: Array<[string, HistoryItem[]]> = (
    [
      ['Recent', recent],
      ['Earlier today', today],
      ['Previous days', earlier]
    ] as Array<[string, HistoryItem[]]>
  ).filter((g) => g[1].length)

  return (
    <div className="mx-auto max-w-[760px] p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="inline-flex items-center gap-2 font-mono text-[14px] font-semibold text-foreground">
          <Icon name="history" className="h-4 w-4 text-primary" />
          Activity history
        </div>
        <div className="ml-auto flex items-center gap-2">
          {extraFilters}
          <div className="relative">
            <Icon
              name="search"
              className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="filter history…"
              className="h-7 w-56 pl-8 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={!onExport || items.length === 0}
          >
            <Icon name="download" className="h-3 w-3" />
            Export
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={!onClear || items.length === 0}
          >
            <Icon name="trash" className="h-3 w-3" />
            Clear
          </Button>
        </div>
      </div>
      {groups.length === 0 && (
        <Card className="grid h-40 place-items-center font-mono text-sm text-dim">
          {items.length === 0 ? 'No activity yet' : 'No matching history'}
        </Card>
      )}
      <div className="space-y-5">
        {groups.map(([title, gItems]) => (
          <div key={title}>
            <div className="mb-2 px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
              {title}
            </div>
            <Card className="overflow-hidden">
              {gItems.map((it, i) => (
                <button
                  key={i}
                  type="button"
                  className="group flex w-full items-center gap-3.5 border-b border-border/50 px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-hover"
                >
                  <span
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-md border bg-muted transition-colors',
                      it.tone === 'destructive'
                        ? 'border-destructive/40'
                        : 'border-border/70 group-hover:border-primary/40'
                    )}
                  >
                    <Icon
                      name={it.icon ?? 'arrowRight'}
                      className={cn(
                        'h-4 w-4 transition-colors',
                        it.tone === 'destructive'
                          ? 'text-destructive'
                          : 'text-dim group-hover:text-primary'
                      )}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[13px] text-foreground">
                      {it.label}
                    </span>
                    {it.sub && (
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-dim">
                        {it.sub}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
                    {it.time} ago
                  </span>
                  <Icon
                    name="arrowRight"
                    className="h-3.5 w-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </button>
              ))}
            </Card>
          </div>
        ))}
      </div>
    </div>
  )
}
