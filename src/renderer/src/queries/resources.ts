import { toast } from '@renderer/ui/components/toaster'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  ConfigDataUpdate,
  CustomResourceList,
  CustomResourceParams,
  ResourceRef,
  ResourceRow
} from '../../../shared/ipc-types'
import {
  applyConfigData,
  applyResourceYaml,
  createResourceYaml,
  fetchConfigData,
  fetchResource,
  fetchResourceDetail,
  fetchResourceYaml
} from '../data/fetchers'
import { errMsg } from '../lib/errors'
import { clusterApi, hasBackend } from '../lib/ipc'
import { recordActivity } from '../lib/record-activity'
import { qk } from './keys'
import { useLiveList } from './live'
import { invalidateMutation } from './mutation-invalidation'

export const useResource = (clusterId: string | null, kind: string, refreshOnMount = false) => {
  const query = useQuery({
    queryKey: qk.resource(clusterId, kind),
    queryFn: () => fetchResource(clusterId, kind),
    refetchOnMount: refreshOnMount ? 'always' : undefined,
    // The live watch (below) streams deltas, so the full collection doesn't need to be
    // refetched on every window-focus — keep it fresh for 30s to avoid redundant reloads.
    staleTime: 30_000
  })
  useLiveList<ResourceRow>(clusterId, kind, qk.resource(clusterId, kind), (r) => r.uid)
  return query
}

/** The live manifest of a single resource, as a YAML string. */
export const useResourceYaml = (clusterId: string | null, ref: ResourceRef) => {
  return useQuery({
    queryKey: qk.yaml(clusterId, ref),
    queryFn: () => fetchResourceYaml(clusterId, ref)
  })
}

/** Apply an edited manifest, then refetch its YAML and the matching list. */
export const useApplyYaml = (clusterId: string | null, ref: ResourceRef) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (yaml: string) => applyResourceYaml(clusterId, ref, yaml),
    onSuccess: () => {
      if (clusterId)
        void invalidateMutation(qc, clusterId, {
          type: 'resource',
          operation: 'apply',
          refs: [ref]
        })
      toast.success(`Applied ${ref.kind}/${ref.name}`)
      if (clusterId)
        recordActivity({
          clusterId,
          action: 'apply-yaml',
          kind: ref.kind,
          namespace: ref.namespace,
          name: ref.name,
          count: 1,
          outcome: 'success'
        })
    },
    onError: (e) => {
      toast.error('Failed to apply', errMsg(e))
      if (clusterId)
        recordActivity({
          clusterId,
          action: 'apply-yaml',
          kind: ref.kind,
          namespace: ref.namespace,
          name: ref.name,
          count: 1,
          outcome: 'error',
          message: errMsg(e)
        })
    }
  })
}

/** Create a resource from a pasted manifest, then refetch the matching list. The
 *  ref (kind/name/namespace) is parsed from the manifest at submit time. */
export const useCreateFromYaml = (clusterId: string | null) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ yaml }: { ref: ResourceRef; yaml: string }) =>
      createResourceYaml(clusterId, yaml),
    onSuccess: (createdRef) => {
      if (clusterId)
        void invalidateMutation(qc, clusterId, {
          type: 'resource',
          operation: 'create',
          refs: [createdRef]
        })
      toast.success(`Created ${createdRef.kind}/${createdRef.name}`)
      if (clusterId)
        recordActivity({
          clusterId,
          action: 'create-yaml',
          kind: createdRef.kind,
          namespace: createdRef.namespace,
          name: createdRef.name,
          count: 1,
          outcome: 'success'
        })
    },
    onError: (e, { ref }) => {
      toast.error('Failed to create', errMsg(e))
      if (clusterId)
        recordActivity({
          clusterId,
          action: 'create-yaml',
          kind: ref.kind,
          namespace: ref.namespace,
          name: ref.name,
          count: 1,
          outcome: 'error',
          message: errMsg(e)
        })
    }
  })
}

/** Live object fields (labels, and for pods containers/QoS/limits) for the Overview tab. */
export const useResourceDetail = (clusterId: string | null, ref: ResourceRef) => {
  return useQuery({
    queryKey: qk.detail(clusterId, ref),
    queryFn: () => fetchResourceDetail(clusterId, ref),
    refetchOnMount: 'always'
  })
}

/** The decoded key/value data of a ConfigMap or Secret. */
export const useConfigData = (clusterId: string | null, ref: ResourceRef) => {
  return useQuery({
    queryKey: qk.configData(clusterId, ref),
    queryFn: () => fetchConfigData(clusterId, ref)
  })
}

/** Apply edited ConfigMap/Secret data, then refetch its data, YAML, and list. */
export const useApplyConfigData = (clusterId: string | null, ref: ResourceRef) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (update: ConfigDataUpdate) => applyConfigData(clusterId, ref, update),
    onSuccess: (result) => {
      if (result.status === 'conflict') {
        toast.error(
          'Save conflict',
          'The resource changed. Review the latest data before retrying.'
        )
        if (clusterId)
          recordActivity({
            clusterId,
            action: 'apply-config',
            kind: ref.kind,
            namespace: ref.namespace,
            name: ref.name,
            count: 1,
            outcome: 'error',
            message: 'The resource changed before it could be saved'
          })
        return
      }
      qc.setQueryData(qk.configData(clusterId, ref), result.current)
      if (result.status === 'unchanged') {
        toast.info('Data is already up to date')
        return
      }
      if (clusterId)
        void invalidateMutation(qc, clusterId, {
          type: 'resource',
          operation: 'data',
          refs: [ref]
        })
      toast.success(`Saved ${ref.kind}/${ref.name}`)
      if (clusterId)
        recordActivity({
          clusterId,
          action: 'apply-config',
          kind: ref.kind,
          namespace: ref.namespace,
          name: ref.name,
          count: 1,
          outcome: 'success'
        })
    },
    onError: (e) => {
      const message =
        ref.kind === 'secrets' ? 'Secret data save failed. Reload and retry.' : errMsg(e)
      toast.error('Failed to save', message)
      if (clusterId)
        recordActivity({
          clusterId,
          action: 'apply-config',
          kind: ref.kind,
          namespace: ref.namespace,
          name: ref.name,
          count: 1,
          outcome: 'error',
          message
        })
    }
  })
}

/** Live instances of a CRD (one-shot — dynamic GVK has no watch). Returns the
 *  CRD's server print columns + rows; empty in a plain browser (no backend). */
export const useCustomResource = (
  clusterId: string | null,
  params: CustomResourceParams,
  refreshOnMount = false
) => {
  return useQuery({
    queryKey: qk.customResource(clusterId, params),
    refetchOnMount: refreshOnMount ? 'always' : undefined,
    queryFn: (): Promise<CustomResourceList> =>
      hasBackend() && clusterId
        ? clusterApi.listCustomResource(clusterId, params)
        : Promise.resolve({ columns: [], rows: [] })
  })
}
