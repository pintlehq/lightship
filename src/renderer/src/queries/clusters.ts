import { toast } from '@renderer/ui/components/toaster'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { ClusterMeta } from '../../../shared/ipc-types'
import { errMsg } from '../lib/errors'
import { clustersApi } from '../lib/ipc'
import { useTabsStore } from '../stores/tabs-store'
import { qk } from './keys'

/** Real persisted clusters from the main process (empty in a plain browser). */
export const useClusters = () =>
  useQuery({ queryKey: qk.clusters(), queryFn: () => clustersApi.list() })

/** Remove a cluster from Lightship (local only): also closes its open tabs so none
 *  are left querying a gone cluster, then refreshes the cluster list. */
export const useRemoveCluster = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => clustersApi.remove(id),
    onSuccess: (_data, id) => {
      useTabsStore.getState().closeTabsForCluster(id)
      qc.removeQueries({ queryKey: qk.clusterConnection(id) })
      void qc.invalidateQueries({ queryKey: qk.clusters() })
      toast.success('Cluster removed')
    },
    onError: (e) => toast.error('Failed to remove cluster', errMsg(e))
  })
}

/** Rename a cluster (local label only), then refresh the cluster list. */
export const useRenameCluster = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => clustersApi.rename(id, name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.clusters() })
      toast.success('Cluster renamed')
    },
    onError: (e) => toast.error('Failed to rename cluster', errMsg(e))
  })
}

/** Persist sidebar cluster ordering, then update the shared cluster-list cache. */
export const useReorderClusters = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => clustersApi.reorder(ids),
    onSuccess: (clusters: ClusterMeta[]) => {
      qc.setQueryData(qk.clusters(), clusters)
      toast.success('Cluster order updated')
    },
    onError: (e) => toast.error('Failed to reorder clusters', errMsg(e))
  })
}
