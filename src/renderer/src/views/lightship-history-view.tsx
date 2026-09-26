import { useEffect, useMemo, useState } from 'react'
import { HistoryView } from '@renderer/ui/shell/history-view'
import { MultiSelect } from '@renderer/ui/components/multi-select'
import { Button } from '@renderer/ui/components/button'
import { Card } from '@renderer/ui/components/card'

import { LIGHTSHIP_HISTORY } from '../data/static'
import { activityToHistoryItem } from '../lib/activity-to-history'
import { hasBackend } from '../lib/ipc'
import { useActivityStore } from '../stores/activity-store'

/** Lightship's Activity history: the persisted, global activity log fed into the
 *  shared HistoryView, with a per-cluster filter. Falls back to the static demo
 *  data in a plain browser (no backend). */
export function LightshipHistoryView() {
  const records = useActivityStore((s) => s.records)
  const pending = useActivityStore((s) => s.pending)
  const refresh = useActivityStore((s) => s.refresh)
  const clear = useActivityStore((s) => s.clear)
  const retryFailed = useActivityStore((s) => s.retryFailed)
  const discardFailed = useActivityStore((s) => s.discardFailed)
  const [clusterFilter, setClusterFilter] = useState<string[]>([])

  // Re-read from disk each time the tab is opened so it reflects actions taken
  // since it was last viewed.
  useEffect(() => {
    void refresh()
  }, [refresh])

  // Cluster names that actually appear in the log — the only ones worth filtering.
  const clusterNames = useMemo(
    () => [...new Set(records.map((r) => r.clusterName))].sort(),
    [records]
  )

  const filtered = useMemo(
    () =>
      clusterFilter.length === 0
        ? records
        : records.filter((r) => clusterFilter.includes(r.clusterName)),
    [records, clusterFilter]
  )

  if (!hasBackend()) {
    // Plain-browser demo: show the static sample, no persistence controls.
    return <HistoryView items={LIGHTSHIP_HISTORY} />
  }

  const exportJson = (): void => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' })
    )
    const a = document.createElement('a')
    a.href = url
    a.download = 'lightship-activity.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      {pending.length > 0 && (
        <div className="mx-auto max-w-[760px] px-5 pt-5">
          <Card className="border-warning/40 p-4">
            <h2 className="font-mono text-[13px] font-semibold text-foreground">
              Unsaved activity
            </h2>
            <p className="mt-1 font-mono text-[11px] text-dim">
              These Kubernetes actions already finished. Retry saves only their history records.
            </p>
            <div className="mt-3 space-y-2">
              {pending.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 border-t border-border pt-2 font-mono text-[12px]"
                >
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {item.input.action} · {item.input.kind ?? 'resource'}
                    {item.input.name ? `/${item.input.name}` : ''}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={item.retrying}
                    onClick={() => void retryFailed(item.id)}
                  >
                    {item.retrying ? 'Saving…' : 'Retry'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={item.retrying}
                    onClick={() => discardFailed(item.id)}
                  >
                    Discard
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
      <HistoryView
        items={filtered.map(activityToHistoryItem)}
        onClear={() => void clear()}
        onExport={exportJson}
        extraFilters={
          clusterNames.length > 1 ? (
            <MultiSelect
              label="Cluster"
              icon="server"
              options={clusterNames}
              selected={clusterFilter}
              onChange={setClusterFilter}
              width="w-56"
            />
          ) : undefined
        }
      />
    </>
  )
}
