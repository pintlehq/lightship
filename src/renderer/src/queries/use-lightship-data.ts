import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@renderer/ui/components/toaster'

import type {
  ClusterMeta,
  CustomResourceList,
  CustomResourceParams,
  Pod,
  ResourceRef,
  ResourceRow
} from '../../../shared/ipc-types'
import { errMsg } from '../lib/errors'
import {
  applyConfigData,
  applyResourceYaml,
  createResourceYaml,
  fetchConfigData,
  fetchEvents,
  fetchNodes,
  fetchNodeDetail,
  fetchOverview,
  fetchOverviewBundle,
  fetchPods,
  fetchResource,
  fetchResourceDetail,
  fetchResourceYaml
} from '../data/fetchers'
import { clusterApi, clustersApi, hasBackend } from '../lib/ipc'
import { applyDeltas } from '../lib/live-cache'
import { recordActivity } from '../lib/record-activity'
import { useTabsStore } from '../stores/tabs-store'
import { useUiStore } from '../stores/ui-store'
import { qk } from './keys'

// Subscribe a query key to a live informer: a `reset` replaces the cached list, a
// `deltas` batch is folded in by identity, and `status` drives the live indicator.
// No-op without a backend (plain browser) — mock data is static, so the query's
// one-shot fetch is enough. Re-subscribes only when the cluster or kind changes.
function useLiveList<T>(
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
function useNodeWatch(clusterId: string | null): void {
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

export const useEvents = (clusterId: string | null, ref?: ResourceRef) => {
  return useQuery({
    queryKey: qk.events(clusterId, ref),
    queryFn: () => fetchEvents(clusterId, ref),
    refetchInterval: 10000
  })
}

export const usePods = (clusterId: string | null) => {
  const query = useQuery({
    queryKey: qk.pods(clusterId),
    queryFn: () => fetchPods(clusterId)
  })
  useLiveList<Pod>(clusterId, 'pods', qk.pods(clusterId), (p) => `${p.ns}/${p.name}`)
  return query
}

export const useNodes = (clusterId: string | null) => {
  const query = useQuery({
    queryKey: qk.nodes(clusterId),
    queryFn: () => fetchNodes(clusterId),
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
    // Slow poll so the point-in-time CPU/memory usage (and the charts) stay fresh.
    refetchInterval: 15000
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

export const useResource = (clusterId: string | null, kind: string) => {
  const query = useQuery({
    queryKey: qk.resource(clusterId, kind),
    queryFn: () => fetchResource(clusterId, kind),
    // The live watch (below) streams deltas, so the full collection doesn't need to be
    // refetched on every window-focus — keep it fresh for 30s to avoid redundant reloads.
    staleTime: 30_000
  })
  useLiveList<ResourceRow>(clusterId, kind, qk.resource(clusterId, kind), (r) => r.uid)
  return query
}

/** All cluster namespaces (names), for filter dropdowns. One-shot — no live watch
 *  needed for a filter list. Empty in a plain browser (no backend). */
export const useNamespaces = (clusterId: string | null) => {
  return useQuery({
    queryKey: qk.resource(clusterId, 'namespaces'),
    queryFn: () => fetchResource(clusterId, 'namespaces')
  })
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
      void qc.invalidateQueries({ queryKey: qk.yaml(clusterId, ref) })
      void qc.invalidateQueries({
        queryKey: ref.kind === 'pods' ? qk.pods(clusterId) : qk.resource(clusterId, ref.kind)
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
export const useCreateFromYaml = (clusterId: string | null, kind: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ yaml }: { ref: ResourceRef; yaml: string }) =>
      createResourceYaml(clusterId, yaml),
    onSuccess: (_data, { ref }) => {
      void qc.invalidateQueries({
        queryKey: kind === 'pods' ? qk.pods(clusterId) : qk.resource(clusterId, kind)
      })
      toast.success(`Created ${ref.kind}/${ref.name}`)
      if (clusterId)
        recordActivity({
          clusterId,
          action: 'create-yaml',
          kind: ref.kind,
          namespace: ref.namespace,
          name: ref.name,
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
    queryFn: () => fetchResourceDetail(clusterId, ref)
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
    mutationFn: (data: Record<string, string>) => applyConfigData(clusterId, ref, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.configData(clusterId, ref) })
      void qc.invalidateQueries({ queryKey: qk.yaml(clusterId, ref) })
      void qc.invalidateQueries({ queryKey: qk.resource(clusterId, ref.kind) })
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
      toast.error('Failed to save', errMsg(e))
      if (clusterId)
        recordActivity({
          clusterId,
          action: 'apply-config',
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

/** Live instances of a CRD (one-shot — dynamic GVK has no watch). Returns the
 *  CRD's server print columns + rows; empty in a plain browser (no backend). */
export const useCustomResource = (clusterId: string | null, params: CustomResourceParams) => {
  return useQuery({
    queryKey: qk.customResource(clusterId, params),
    queryFn: (): Promise<CustomResourceList> =>
      hasBackend() && clusterId
        ? clusterApi.listCustomResource(clusterId, params)
        : Promise.resolve({ columns: [], rows: [] })
  })
}

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
