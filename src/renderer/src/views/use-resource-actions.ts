import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@renderer/ui/components/toaster'

import type { ResourceRef, ResourceRow } from '../../../shared/ipc-types'
import { errMsg } from '../lib/errors'
import { clusterApi } from '../lib/ipc'
import { recordActivity } from '../lib/record-activity'
import { qk } from '../queries/keys'

type ResourceBatchAction = 'delete' | 'restart'

interface PendingResourceAction {
  op: ResourceBatchAction
  rows: ResourceRow[]
  fromSelection: boolean
}

interface ResourceActionProgress {
  label: string
  done: number
  total: number
}

export function useResourceActions({
  clusterId,
  resourceId,
  label,
  onSelectionActionComplete
}: {
  clusterId: string
  resourceId: string
  label: string
  onSelectionActionComplete: () => void
}) {
  const qc = useQueryClient()
  const [pending, setPending] = useState<PendingResourceAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ResourceActionProgress | null>(null)

  const startAction = useCallback(
    (op: ResourceBatchAction, rows: ResourceRow[], fromSelection = false) =>
      setPending({ op, rows, fromSelection }),
    []
  )

  const cancelAction = useCallback(() => setPending(null), [])

  const runAction = useCallback(async () => {
    if (!pending || !clusterId) return
    const { op, rows } = pending
    const total = rows.length
    const noun = label.toLowerCase()
    const past = op === 'delete' ? 'Deleted' : 'Restarted'
    setBusy(true)
    setProgress({ label: op === 'delete' ? 'Deleting' : 'Restarting', done: 0, total })

    let ok = 0
    let failed = 0
    let lastErr: unknown = null
    for (const r of rows) {
      const ref: ResourceRef = { kind: resourceId, namespace: r.namespace, name: r.name }
      try {
        if (op === 'delete') await clusterApi.deleteResource(clusterId, ref)
        else await clusterApi.rolloutRestart(clusterId, ref)
        ok++
      } catch (e) {
        console.error(e)
        failed++
        lastErr = e
      }
      setProgress({ label: op === 'delete' ? 'Deleting' : 'Restarting', done: ok + failed, total })
    }

    await qc.invalidateQueries({ queryKey: qk.resource(clusterId, resourceId) })
    if (pending.fromSelection) onSelectionActionComplete()
    if (failed === 0) toast.success(`${past} ${ok} ${noun}`)
    else if (ok === 0)
      toast.error(op === 'delete' ? 'Failed to delete' : 'Failed to restart', errMsg(lastErr))
    else toast.error(`${past} ${ok}, ${failed} failed`, errMsg(lastErr))

    recordActivity({
      clusterId,
      action: op === 'delete' ? 'delete' : 'restart',
      kind: resourceId,
      namespace: total === 1 ? rows[0].namespace : undefined,
      name: total === 1 ? rows[0].name : undefined,
      count: total,
      outcome: failed === 0 ? 'success' : 'error',
      message: failed > 0 ? `${ok} ok, ${failed} failed` : undefined
    })
    setBusy(false)
    setProgress(null)
    setPending(null)
  }, [clusterId, label, onSelectionActionComplete, pending, qc, resourceId])

  return { pending, busy, progress, startAction, cancelAction, runAction }
}
