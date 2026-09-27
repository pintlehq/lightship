import { useQuery } from '@tanstack/react-query'

import { fetchNodeDetail, fetchNodes } from '../../data/fetchers'
import { qk } from '../../queries/keys'
import { useNodeWatch } from '../../queries/live'

export const useNodes = (clusterId: string | null, refreshOnMount = false) => {
  const query = useQuery({
    queryKey: qk.nodes(clusterId),
    queryFn: () => fetchNodes(clusterId),
    refetchOnMount: refreshOnMount ? 'always' : undefined,
    // Slow poll for metric/pod-count drift; structural changes arrive live below.
    refetchInterval: 15000
  })
  useNodeWatch(clusterId)
  return query
}

export const useNodeDetail = (clusterId: string | null, name: string) => {
  return useQuery({
    queryKey: qk.nodeDetail(clusterId, name),
    queryFn: () => fetchNodeDetail(clusterId, name),
    refetchOnMount: 'always',
    // Slow poll so the point-in-time CPU/memory usage (and the charts) stay fresh.
    refetchInterval: 15000
  })
}
