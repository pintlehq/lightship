import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { toast } from '@renderer/ui/components/toaster'

import type { DrainHandle, DrainProgress, DrainResult } from '../../../../shared/ipc-types'
import { errMsg } from '../../lib/errors'
import { clusterApi } from '../../lib/ipc'
import { queueFailedActivity, recordActivity } from '../../lib/record-activity'
import { invalidateMutation } from '../../queries/mutation-invalidation'
import { useActivityStore } from '../../stores/activity-store'
import type { NodeRow } from '../../types'

type NodeOp = 'cordon' | 'uncordon' | 'drain'

export function useNodeActions(clusterId: string, onSelectionActionComplete: () => void) {
  const qc = useQueryClient()
  // Pending op — a single node (kebab / right-click) or the whole selection (bulk
  // bar); selection is only cleared for the latter.
  const [pending, setPending] = useState<{
    op: NodeOp
    nodes: NodeRow[]
    fromSelection: boolean
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [drainProgress, setDrainProgress] = useState<DrainProgress | null>(null)
  const [drainReport, setDrainReport] = useState<{
    completed: string[]
    interrupted?: DrainResult
    unprocessed: string[]
  } | null>(null)
  const [completedNodes, setCompletedNodes] = useState(0)
  const [cancelRequested, setCancelRequested] = useState(false)
  const cancelRequestedRef = useRef(false)
  const activeDrain = useRef<DrainHandle | null>(null)
  useEffect(() => () => activeDrain.current?.cancel(), [])
  const start = useCallback((op: NodeOp, ns: NodeRow[], fromSelection = false) => {
    setDrainProgress(null)
    setDrainReport(null)
    setCompletedNodes(0)
    setCancelRequested(false)
    cancelRequestedRef.current = false
    setPending({ op, nodes: ns, fromSelection })
  }, [])

  const runAction = async () => {
    if (!pending || !clusterId) return
    if (drainReport) {
      setPending(null)
      setDrainReport(null)
      return
    }
    const { op, nodes: target } = pending
    const noun = `${target.length} node${target.length > 1 ? 's' : ''}`
    const done = { cordon: 'Cordoned', uncordon: 'Uncordoned', drain: 'Drained' }[op]
    const changedNodes: string[] = []
    setBusy(true)
    try {
      if (op === 'drain') {
        const completed: string[] = []
        let interrupted: DrainResult | undefined
        for (const node of target) {
          if (cancelRequestedRef.current) break
          let result: DrainResult
          try {
            const handle = clusterApi.drain(clusterId, node.name, setDrainProgress)
            activeDrain.current = handle
            if (cancelRequestedRef.current) handle.cancel()
            result = await handle.result
          } catch (error) {
            result = {
              clusterId,
              node: node.name,
              status: 'failed',
              reason: errMsg(error),
              pods: [],
              remaining: []
            }
            // Startup failures never reach the main-process operation recorder.
            recordActivity({
              clusterId,
              action: 'drain',
              kind: 'nodes',
              name: node.name,
              count: 1,
              outcome: 'error',
              message: result.reason
            })
          } finally {
            activeDrain.current = null
          }
          await invalidateMutation(qc, clusterId, {
            type: 'node',
            operation: 'drain',
            names: [node.name],
            namespaces: [
              ...new Set([...result.pods, ...result.remaining].map((pod) => pod.namespace))
            ]
          })
          if (result.activityRecord) useActivityStore.getState().prepend(result.activityRecord)
          if (result.activityError)
            queueFailedActivity({
              clusterId,
              action: 'drain',
              kind: 'nodes',
              name: node.name,
              count: 1,
              outcome: result.status === 'completed' ? 'success' : 'error',
              message: result.reason ?? 'All eligible pods left the node'
            })
          if (result.status !== 'completed') {
            interrupted = result
            break
          }
          completed.push(node.name)
          setCompletedNodes(completed.length)
        }
        const unprocessed = target
          .slice(completed.length + (interrupted ? 1 : 0))
          .map((n) => n.name)
        if (interrupted || unprocessed.length) {
          setDrainReport({ completed, interrupted, unprocessed })
          toast.error('Drain incomplete', interrupted?.reason ?? 'Cancelled before the next node')
        } else {
          if (pending.fromSelection) onSelectionActionComplete()
          toast.success(`${done} ${noun}`)
          setPending(null)
        }
        return
      }
      for (const n of target) {
        if (op === 'cordon') await clusterApi.cordon(clusterId, n.name)
        else if (op === 'uncordon') await clusterApi.uncordon(clusterId, n.name)
        changedNodes.push(n.name)
      }
      await invalidateMutation(qc, clusterId, { type: 'node', operation: op, names: changedNodes })
      if (pending.fromSelection) onSelectionActionComplete()
      toast.success(`${done} ${noun}`)
      recordActivity({
        clusterId,
        action: op,
        kind: 'nodes',
        name: target.length === 1 ? target[0].name : undefined,
        count: target.length,
        outcome: 'success'
      })
    } catch (e) {
      console.error(e)
      if (op !== 'drain' && changedNodes.length)
        await invalidateMutation(qc, clusterId, {
          type: 'node',
          operation: op,
          names: changedNodes
        })
      toast.error(`Failed to ${op}`, errMsg(e))
      recordActivity({
        clusterId,
        action: op,
        kind: 'nodes',
        name: target.length === 1 ? target[0].name : undefined,
        count: target.length,
        outcome: 'error',
        message: changedNodes.length
          ? `${changedNodes.length} changed, ${target.length - changedNodes.length} not changed: ${errMsg(e)}`
          : errMsg(e)
      })
    } finally {
      setBusy(false)
      if (op !== 'drain') setPending(null)
    }
  }

  const cancelAction = () => {
    if (!busy) {
      setPending(null)
      setDrainReport(null)
      return
    }
    if (pending?.op === 'drain' && !cancelRequestedRef.current) {
      cancelRequestedRef.current = true
      setCancelRequested(true)
      activeDrain.current?.cancel()
    }
  }

  const n = pending?.nodes.length ?? 0
  const confirmText: Record<NodeOp, { title: string; message: string; label: string }> = {
    cordon: {
      title: `Cordon ${n} node${n > 1 ? 's' : ''}?`,
      message: 'Marks the selected nodes unschedulable. Running pods are left in place.',
      label: 'Cordon'
    },
    uncordon: {
      title: `Uncordon ${n} node${n > 1 ? 's' : ''}?`,
      message:
        'Clears the unschedulable flag so the scheduler can place pods on these nodes again.',
      label: 'Uncordon'
    },
    drain: {
      title: `Drain ${n} node${n > 1 ? 's' : ''}?`,
      message:
        'Cordons each node, then waits for eligible pods to leave. DaemonSet, mirror, and completed pods are skipped. Unmanaged pods and pods using emptyDir block the drain. Once cordoned, interrupted nodes remain cordoned.',
      label: 'Drain'
    }
  }

  return {
    pending,
    busy,
    drainProgress,
    drainReport,
    completedNodes,
    cancelRequested,
    start,
    runAction,
    cancelAction,
    confirmText
  }
}
