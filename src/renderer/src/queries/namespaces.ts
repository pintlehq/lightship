import { toast } from '@renderer/ui/components/toaster'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { NamespaceCreateInput } from '../../../shared/ipc-types'
import {
  createNamespaceResource,
  deleteNamespaceResource,
  fetchNamespaceDetail,
  fetchNamespaceSummaries,
  fetchResource
} from '../data/fetchers'
import { errMsg } from '../lib/errors'
import { recordActivity } from '../lib/record-activity'
import { qk } from './keys'
import { invalidateMutation } from './mutation-invalidation'

export const useNamespaceSummaries = (clusterId: string | null) =>
  useQuery({
    queryKey: qk.namespaceSummaries(clusterId),
    queryFn: () => fetchNamespaceSummaries(clusterId),
    refetchInterval: 30_000
  })

export const useNamespaceDetail = (clusterId: string | null, name: string) =>
  useQuery({
    queryKey: qk.namespaceDetail(clusterId, name),
    queryFn: () => fetchNamespaceDetail(clusterId, name),
    refetchInterval: 30_000
  })

export const useCreateNamespace = (clusterId: string | null) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: NamespaceCreateInput) => createNamespaceResource(clusterId, input),
    onSuccess: (_data, input) => {
      const name = input.mode === 'form' ? input.name : undefined
      if (clusterId)
        void invalidateMutation(qc, clusterId, {
          type: 'namespace',
          operation: 'create',
          names: name ? [name] : []
        })
      toast.success(`Created namespace${name ? ` ${name}` : ''}`)
      if (clusterId)
        recordActivity({
          clusterId,
          action: 'create-yaml',
          kind: 'namespaces',
          name,
          count: 1,
          outcome: 'success'
        })
    },
    onError: (error, input) => {
      toast.error('Failed to create namespace', errMsg(error))
      if (clusterId)
        recordActivity({
          clusterId,
          action: 'create-yaml',
          kind: 'namespaces',
          name: input.mode === 'form' ? input.name : undefined,
          count: 1,
          outcome: 'error',
          message: errMsg(error)
        })
    }
  })
}

export const useDeleteNamespace = (clusterId: string | null) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => deleteNamespaceResource(clusterId, name),
    onSuccess: (_data, name) => {
      if (clusterId)
        void invalidateMutation(qc, clusterId, {
          type: 'namespace',
          operation: 'delete',
          names: [name]
        })
      toast.success(`Namespace ${name} is being deleted`)
      if (clusterId)
        recordActivity({
          clusterId,
          action: 'delete',
          kind: 'namespaces',
          name,
          count: 1,
          outcome: 'success'
        })
    },
    onError: (error, name) => {
      toast.error('Failed to delete namespace', errMsg(error))
      if (clusterId)
        recordActivity({
          clusterId,
          action: 'delete',
          kind: 'namespaces',
          name,
          count: 1,
          outcome: 'error',
          message: errMsg(error)
        })
    }
  })
}

/** All cluster namespaces (names), for filter dropdowns. One-shot — no live watch
 *  needed for a filter list. Empty in a plain browser (no backend). */
export const useNamespaces = (clusterId: string | null) => {
  return useQuery({
    queryKey: qk.resource(clusterId, 'namespaces'),
    queryFn: () => fetchResource(clusterId, 'namespaces')
  })
}
