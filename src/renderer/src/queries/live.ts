import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { clusterApi, hasBackend } from '../lib/ipc'
import { applyDeltas } from '../lib/live-cache'
import { useUiStore } from '../stores/ui-store'
import { qk } from './keys'

// Subscribe a query key to a live informer: a `reset` replaces the cached list, a
// `deltas` batch is folded in by identity, and `status` drives the live indicator.
// No-op without a backend (plain browser) — mock data is static, so the query's
// one-shot fetch is enough. Re-subscribes only when the cluster or kind changes.
export function useLiveList<T>(
  clusterId: string | null,
  kind: string,
  queryKey: readonly unknown[],
  keyOf: (row: T) => string
): void {
  const qc = useQueryClient()
  const setLiveStatus = useUiStore((s) => s.setLiveStatus)
  useEffect(() => {
    if (!hasBackend() || !clusterId) return
    setLiveStatus('connecting')
    const unsub = clusterApi.watch(clusterId, kind, (ev) => {
      if (ev.type === 'reset') qc.setQueryData(queryKey, ev.rows as T[])
      else if (ev.type === 'deltas')
        qc.setQueryData(queryKey, (prev?: T[]) => applyDeltas(prev, ev.items, keyOf))
      else setLiveStatus(ev.state)
    })
    return unsub
    // queryKey/keyOf are stable for a given (clusterId, kind); resubscribe only on those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterId, kind])
}

// Nodes carry metrics + pod counts (no watch API), so a node change can't be a
// row delta — instead the node informer triggers a debounced refetch of the full
// nodes list, while a slow poll covers metric drift between changes.
export function useNodeWatch(clusterId: string | null): void {
  const qc = useQueryClient()
  const setLiveStatus = useUiStore((s) => s.setLiveStatus)
  useEffect(() => {
    if (!hasBackend() || !clusterId) return
    setLiveStatus('connecting')
    let timer: ReturnType<typeof setTimeout> | null = null
    const refetch = (): void => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        void qc.invalidateQueries({ queryKey: qk.nodes(clusterId) })
      }, 500)
    }
    const unsub = clusterApi.watch(clusterId, 'nodes', (ev) => {
      if (ev.type === 'status') setLiveStatus(ev.state)
      else refetch()
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsub()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterId])
}
