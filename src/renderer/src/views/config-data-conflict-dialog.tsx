import { useMemo, useState } from 'react'
import { Button } from '@renderer/ui/components/button'
import { Overlay } from '@renderer/ui/components/overlay'

import type { ConfigData } from '../../../shared/ipc-types'
import { mergeEntries, mergedTextData, type MergeCell, type MergeChoice } from './config-data-merge'

function Value({ cell, secret, label }: { cell: MergeCell; secret: boolean; label: string }) {
  const [revealed, setRevealed] = useState(false)
  if (cell.type === 'absent') return <span className="text-faint">Absent</span>
  if (cell.type === 'binary') return <span className="text-faint">Binary value preserved</span>
  if (secret && !revealed) {
    return (
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Reveal ${label}`}
        onClick={() => setRevealed(true)}
      >
        Reveal value
      </Button>
    )
  }
  return <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all">{cell.value}</pre>
}

export function ConfigDataConflictDialog({
  base,
  draft,
  latest,
  onStage,
  onUseLatest,
  onClose
}: {
  base: ConfigData
  draft: Record<string, string>
  latest: ConfigData
  onStage: (data: Record<string, string>) => void
  onUseLatest: () => void
  onClose: () => void
}) {
  const entries = useMemo(() => mergeEntries(base, draft, latest), [base, draft, latest])
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({})
  const merged = mergedTextData(entries, choices)
  const unresolved = entries.filter((entry) => entry.automatic === null && !choices[entry.key])

  return (
    <Overlay open onClose={onClose}>
      <div className="flex max-h-[85vh] w-[760px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border-strong bg-card shadow-lg">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-mono text-[14px] font-semibold text-foreground">
            Review conflicting data changes
          </h2>
          <p role="alert" className="mt-2 font-mono text-[12px] text-muted-foreground">
            This resource changed since you opened it. Your draft is intact. Review each key before
            continuing; nothing will be saved until you confirm Apply again.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {entries.map((entry) => {
            const conflicting = entry.automatic === null
            return (
              <section key={entry.key} className="mb-3 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="break-all font-mono text-[12px] font-semibold text-foreground">
                    {entry.key}
                  </h3>
                  <span className="font-mono text-[11px] text-dim">
                    {conflicting ? 'Choose a version' : 'Merged automatically'}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px]">
                  {(
                    [
                      ['Opened', entry.base],
                      ['Your draft', entry.mine],
                      ['Latest', entry.latest]
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="min-w-0 rounded bg-chrome p-2">
                      <div className="mb-1 text-faint">{label}</div>
                      <Value cell={value} secret={latest.secret} label={`${label} ${entry.key}`} />
                    </div>
                  ))}
                </div>
                {conflicting && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      variant={choices[entry.key] === 'mine' ? 'default' : 'outline'}
                      size="sm"
                      disabled={!entry.canKeepMine}
                      onClick={() => setChoices((prev) => ({ ...prev, [entry.key]: 'mine' }))}
                    >
                      Keep mine
                    </Button>
                    <Button
                      variant={choices[entry.key] === 'latest' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setChoices((prev) => ({ ...prev, [entry.key]: 'latest' }))}
                    >
                      Use latest
                    </Button>
                    {!entry.canKeepMine && (
                      <span className="font-mono text-[11px] text-dim">
                        Latest value is binary and cannot be overwritten here.
                      </span>
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-chrome px-4 py-3">
          {unresolved.length > 0 && (
            <span className="mr-auto font-mono text-[11px] text-destructive">
              {unresolved.length} unresolved {unresolved.length === 1 ? 'key' : 'keys'}
            </span>
          )}
          <Button variant="outline" onClick={onClose}>
            Keep editing
          </Button>
          <Button variant="destructive" onClick={onUseLatest}>
            Discard draft and use latest
          </Button>
          <Button disabled={!merged} onClick={() => merged && onStage(merged)}>
            Continue with merged draft
          </Button>
        </div>
      </div>
    </Overlay>
  )
}
