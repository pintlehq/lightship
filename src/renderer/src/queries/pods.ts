import { useQuery } from '@tanstack/react-query'

import type { Pod } from '../../../shared/ipc-types'
import { fetchPods } from '../data/fetchers'
import { qk } from './keys'
import { useLiveList } from './live'

export const usePods = (clusterId: string | null, refreshOnMount = false) => {
  const query = useQuery({
    queryKey: qk.pods(clusterId),
    queryFn: () => fetchPods(clusterId),
    refetchOnMount: refreshOnMount ? 'always' : undefined
  })
  useLiveList<Pod>(clusterId, 'pods', qk.pods(clusterId), (p) => `${p.ns}/${p.name}`)
  return query
}
