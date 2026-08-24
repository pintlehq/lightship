import { useState } from 'react'
import { Button } from '@renderer/ui/components/button'
import { Card } from '@renderer/ui/components/card'
import { Dot } from '@renderer/ui/components/dot'
import { Icon } from '@renderer/ui/components/icon'
import { toast } from '@renderer/ui/components/toaster'
import { cn } from '@renderer/ui/lib/utils'
import type { Tone } from '@renderer/ui/lib/types'

import type { ClusterMeta, TestResult } from '../../../shared/ipc-types'
import { clustersApi } from '../lib/ipc'
import {
  useClusters,
  useRemoveCluster,
  useRenameCluster,
  useReorderClusters
} from '../queries/use-lightship-data'
import { ConfirmDialog } from './confirm-dialog'

type RowTest = TestResult | 'testing'
const HEAD =
  'text-left text-2xs uppercase tracking-[0.06em] text-dim font-medium px-3 py-2 bg-background border-b border-border'
const CELL = 'px-3 py-2.5 border-b border-border/50'

export function ManageClustersView({ onAdd }: { onAdd: () => void }) {
  const { data: clusters = [], isLoading } = useClusters()
  const [tests, setTests] = useState<Record<string, RowTest>>({})
  const [confirming, setConfirming] = useState<ClusterMeta | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const remove = useRemoveCluster()
  const rename = useRenameCluster()
  const reorder = useReorderClusters()

  const startRename = (c: ClusterMeta) => {
    setRenamingId(c.id)
    setDraft(c.name)
  }
  const commitRename = (c: ClusterMeta) => {
    const name = draft.trim()
    setRenamingId(null)
    if (name && name !== c.name) rename.mutate({ id: c.id, name })
  }

  const [syncing, setSyncing] = useState(false)
  const sync = async (id: string) => {
    setTests((t) => ({ ...t, [id]: 'testing' }))
    const result = await clustersApi.test(id)
    setTests((t) => ({ ...t, [id]: result }))
  }
  const syncAll = async () => {
    setSyncing(true)
    await Promise.all(clusters.map((c) => sync(c.id)))
    setSyncing(false)
    toast.success(`Synced ${clusters.length} cluster${clusters.length > 1 ? 's' : ''}`)
  }

  const healthTone = (id: string): Tone => {
    const t = tests[id]
    if (!t || t === 'testing') return 'dim'
    return t.ok ? 'success' : 'destructive'
  }

  const moveCluster = (index: number, direction: -1 | 1): void => {
    const target = index + direction
    if (target < 0 || target >= clusters.length) return
    const ids = clusters.map((c) => c.id)
    const current = ids[index]
    ids[index] = ids[target]
    ids[target] = current
    reorder.mutate(ids)
  }

  return (
    <div className="p-5">
      <div className="mb-3.5 flex items-center gap-3">
        <div className="font-mono text-[14px] font-semibold text-foreground">Manage clusters</div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void syncAll()}
            disabled={clusters.length === 0 || syncing}
          >
            <Icon name="refresh" className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
            Sync all
          </Button>
          <Button onClick={onAdd}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add cluster
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="grid h-32 place-items-center font-mono text-sm text-dim">Loading…</div>
        ) : clusters.length === 0 ? (
          <div className="grid h-32 place-items-center gap-2 text-center font-mono text-[12.5px] text-dim">
            <Icon name="server" className="h-7 w-7 text-faint" />
            <span>No clusters yet — add one to get started</span>
          </div>
        ) : (
          <table className="w-full border-collapse font-mono text-[13px]">
            <thead>
              <tr>
                {['', 'CONTEXT', 'SERVER', 'VERSION', 'STATUS', 'ORDER', ''].map((h, i) => (
                  <th key={i} className={cn(HEAD, h === '' && 'w-8')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clusters.map((c, index) => {
                const t = tests[c.id]
                return (
                  <tr key={c.id} className="group transition-colors hover:bg-hover">
                    <td className={cn(CELL, 'w-8')}>
                      <Dot tone={healthTone(c.id)} pulse={t === 'testing'} />
                    </td>
                    <td className={CELL}>
                      {renamingId === c.id ? (
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(c)
                            else if (e.key === 'Escape') setRenamingId(null)
                          }}
                          onBlur={() => commitRename(c)}
                          className="h-[22px] w-full min-w-0 rounded border border-primary bg-background px-1.5 font-mono text-[13px] text-foreground outline-none"
                        />
                      ) : (
                        <div className="group/name flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => startRename(c)}
                            title="Click to rename"
                            className="text-left text-foreground hover:text-primary"
                          >
                            {c.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => startRename(c)}
                            title="Rename"
                            className="text-faint opacity-0 transition-opacity hover:text-primary group-hover/name:opacity-100"
                          >
                            <Icon name="pencil" className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      <div className="text-[11px] text-faint">{c.context}</div>
                    </td>
                    <td className={cn(CELL, 'max-w-[280px] truncate text-muted-foreground')}>
                      {c.server || '—'}
                    </td>
                    <td className={cn(CELL, 'text-muted-foreground')}>
                      {t && t !== 'testing' && t.ok ? t.version : '—'}
                    </td>
                    <td className={CELL}>
                      {t === 'testing' ? (
                        <span className="text-dim">testing…</span>
                      ) : t && t.ok ? (
                        <span className="inline-flex items-center gap-1.5 text-success">
                          <Dot tone="success" />
                          connected
                        </span>
                      ) : t && !t.ok ? (
                        <span
                          className="inline-flex items-center gap-1.5 text-destructive"
                          title={t.error}
                        >
                          <Dot tone="destructive" />
                          error
                        </span>
                      ) : (
                        <span className="text-faint">not tested</span>
                      )}
                    </td>
                    <td className={CELL}>
                      <div className="inline-flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Move up"
                          aria-label={`Move ${c.name} up`}
                          disabled={index === 0 || reorder.isPending}
                          onClick={() => moveCluster(index, -1)}
                        >
                          <Icon name="arrowDown" className="h-3.5 w-3.5 rotate-180" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Move down"
                          aria-label={`Move ${c.name} down`}
                          disabled={index === clusters.length - 1 || reorder.isPending}
                          onClick={() => moveCluster(index, 1)}
                        >
                          <Icon name="arrowDown" className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                    <td className={cn(CELL, 'text-right')}>
                      <div className="inline-flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Test connection"
                          onClick={() => void sync(c.id)}
                        >
                          <Icon name="refresh" className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Remove"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setConfirming(c)}
                        >
                          <Icon name="x" className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      <ConfirmDialog
        open={!!confirming}
        danger
        title={confirming ? `Remove "${confirming.name}"?` : ''}
        message="Removes the cluster from Lightship and deletes its stored kubeconfig. The cluster itself is not affected, and any open tabs for it will close."
        confirmLabel="Remove"
        busy={remove.isPending}
        onConfirm={() =>
          confirming && remove.mutate(confirming.id, { onSuccess: () => setConfirming(null) })
        }
        onCancel={() => setConfirming(null)}
      />
    </div>
  )
}
