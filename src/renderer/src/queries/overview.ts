import { useQuery } from '@tanstack/react-query'

import type { ResourceRef } from '../../../shared/ipc-types'
import { fetchEvents, fetchOverview, fetchOverviewBundle } from '../data/fetchers'
import { qk } from './keys'

export const useEvents = (clusterId: string | null, ref?: ResourceRef) => {
  return useQuery({
    queryKey: qk.events(clusterId, ref),
    queryFn: () => fetchEvents(clusterId, ref),
    refetchInterval: 10000
  })
}

export const useOverview = (clusterId: string | null) => {
  return useQuery({
    queryKey: qk.overview(clusterId),
    queryFn: () => fetchOverview(clusterId),
    refetchInterval: 5000
  })
}

export const useOverviewBundle = (clusterId: string | null) => {
  return useQuery({
    queryKey: qk.overviewBundle(clusterId),
    queryFn: () => fetchOverviewBundle(clusterId),
    refetchInterval: 5000
  })
}
