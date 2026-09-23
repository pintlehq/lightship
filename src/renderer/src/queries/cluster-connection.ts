import { useRef } from 'react'
import { type QueryClient, useQueries, useQueryClient } from '@tanstack/react-query'
import { toast } from '@renderer/ui/components/toaster'

import type { TestResult } from '../../../shared/ipc-types'
import { errMsg } from '../lib/errors'
import { clustersApi, hasBackend } from '../lib/ipc'
import { qk } from './keys'

const connectionOptions = (clusterId: string) => ({
  queryKey: qk.clusterConnection(clusterId),
  queryFn: async (): Promise<TestResult> => {
    try {
      return await clustersApi.test(clusterId)
    } catch (error) {
      return { ok: false, error: errMsg(error) }
    }
  },
  enabled: false as const
})

/** Observe saved checks without starting network work when a cluster row mounts. */
export function useClusterConnections(ids: string[]) {
  return useQueries({ queries: ids.map(connectionOptions) })
}

/** Explicitly test, including when a previous check succeeded. Concurrent calls share one query. */
export function checkClusterConnection(qc: QueryClient, id: string): Promise<TestResult> {
  return qc.fetchQuery({ ...connectionOptions(id), staleTime: 0 })
}

/** A successful check is reusable for this app session; a failed one is retried. */
export function ensureClusterConnection(qc: QueryClient, id: string): Promise<TestResult> {
  if (!hasBackend()) return Promise.resolve({ ok: true })
  const state = qc.getQueryState<TestResult>(qk.clusterConnection(id))
  if (state?.fetchStatus !== 'fetching' && state?.data?.ok) return Promise.resolve(state.data)
  return checkClusterConnection(qc, id)
}

/** Keep only the most recent navigation when several first-use checks overlap. */
export function useClusterNavigation() {
  const qc = useQueryClient()
  const latest = useRef(0)

  return (clusterId: string, clusterName: string, open: () => void): void => {
    const request = ++latest.current
    void ensureClusterConnection(qc, clusterId).then((result) => {
      if (request !== latest.current) return
      if (result.ok) open()
      else toast.error(`Could not connect to ${clusterName}`, result.error ?? 'Connection failed')
    })
  }
}
