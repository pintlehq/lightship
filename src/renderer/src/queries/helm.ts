import { useQuery } from '@tanstack/react-query'

import { clusterApi, hasBackend } from '../lib/ipc'
import { qk } from './keys'

/** Installed Helm releases (latest revision each). */
export const useHelmReleases = (clusterId: string | null) => {
  return useQuery({
    queryKey: qk.helmReleases(clusterId),
    queryFn: () =>
      hasBackend() && clusterId ? clusterApi.helmReleases(clusterId) : Promise.resolve([])
  })
}

/** Revision history of one Helm release. */
export const useHelmRevisions = (clusterId: string | null, namespace: string, name: string) => {
  return useQuery({
    queryKey: qk.helmRevisions(clusterId, namespace, name),
    queryFn: () =>
      hasBackend() && clusterId
        ? clusterApi.helmRevisions(clusterId, namespace, name)
        : Promise.resolve([])
  })
}
