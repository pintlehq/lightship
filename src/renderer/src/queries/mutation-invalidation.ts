import type { QueryClient, QueryKey } from '@tanstack/react-query'

import type { ResourceRef } from '../../../shared/ipc-types'
import { qk } from './keys'

export type MutationImpact =
  | {
      type: 'resource'
      operation: 'apply' | 'create' | 'delete' | 'restart' | 'scale' | 'data'
      refs: ResourceRef[]
    }
  | { type: 'namespace'; operation: 'create' | 'delete'; names: string[] }
  | {
      type: 'node'
      operation: 'cordon' | 'uncordon' | 'drain'
      names: string[]
      namespaces?: string[]
    }

/** One place for the cache effects of a confirmed Kubernetes change. Inactive
 * queries become stale; active queries refetch without waiting for polling. */
export async function invalidateMutation(
  qc: QueryClient,
  clusterId: string,
  impact: MutationImpact
): Promise<void> {
  const prefixes = new Map<string, QueryKey>()
  const deletedNamespaces = new Set<string>()
  const add = (key: QueryKey): void => {
    prefixes.set(JSON.stringify(key), key)
  }
  const overview = (): void => {
    add(qk.overview(clusterId))
    add(qk.overviewBundle(clusterId))
  }
  const namespaceSummary = (): void => add(qk.namespaceSummaries(clusterId))
  const namespaceDetail = (name: string | undefined): void => {
    if (name) add(qk.namespaceDetail(clusterId, name))
  }
  const pods = (): void => {
    add(qk.pods(clusterId))
    add(qk.resource(clusterId, 'pods'))
  }
  const nodeDetails = (): void => add(['node-detail', clusterId])
  const workloadKinds = new Set([
    'deployments',
    'statefulsets',
    'daemonsets',
    'jobs',
    'cronjobs',
    'replicasets',
    'replicationcontrollers'
  ])

  if (impact.type === 'resource') {
    for (const ref of impact.refs) {
      add(qk.yaml(clusterId, ref))
      add(qk.detail(clusterId, ref))
      add(qk.configData(clusterId, ref))
      add(qk.events(clusterId, ref))
      add(qk.resource(clusterId, ref.kind))
      if (ref.apiVersion) {
        const parts = ref.apiVersion.split('/')
        add(
          parts.length === 2
            ? ['custom-resource', clusterId, parts[0], parts[1]]
            : ['custom-resource', clusterId]
        )
      }
      if (ref.kind === 'crd') add(['custom-resource', clusterId])
      if (ref.kind === 'pods') {
        pods()
        add(qk.nodes(clusterId))
        nodeDetails()
      }
      if (ref.kind === 'nodes') {
        add(qk.nodes(clusterId))
        add(qk.nodeDetail(clusterId, ref.name))
      }
      if (workloadKinds.has(ref.kind)) pods()
      if (ref.kind === 'namespaces') {
        add(qk.resource(clusterId, 'namespaces'))
        namespaceDetail(ref.name)
        if (impact.operation === 'delete') deletedNamespaces.add(ref.name)
      }
      if (ref.kind === 'secrets') {
        add(qk.helmReleases(clusterId))
        add(['helm-revisions', clusterId])
      }
      if (impact.operation !== 'data') namespaceDetail(ref.namespace)
    }
    if (impact.refs.length > 0) {
      add(['events', clusterId])
      if (impact.operation !== 'data') {
        overview()
        namespaceSummary()
      }
      if (impact.operation === 'restart' || impact.operation === 'scale') {
        pods()
        add(qk.nodes(clusterId))
        nodeDetails()
      }
    }
  } else if (impact.type === 'namespace') {
    if (impact.operation === 'create' || impact.names.length > 0) {
      add(qk.resource(clusterId, 'namespaces'))
      add(['events', clusterId])
      namespaceSummary()
      overview()
      for (const name of impact.names) namespaceDetail(name)
      if (impact.operation === 'delete') {
        for (const name of impact.names) deletedNamespaces.add(name)
      }
    }
  } else if (impact.names.length > 0) {
    add(qk.nodes(clusterId))
    for (const name of impact.names) {
      add(qk.nodeDetail(clusterId, name))
      add(qk.events(clusterId, { kind: 'nodes', name }))
    }
    add(['events', clusterId])
    overview()
    if (impact.operation === 'drain') {
      pods()
      add(['resource', clusterId])
      add(['events', clusterId])
      namespaceSummary()
      for (const name of impact.namespaces ?? []) namespaceDetail(name)
    }
  }

  if (deletedNamespaces.size > 0) {
    pods()
    add(qk.nodes(clusterId))
    nodeDetails()
    add(['resource', clusterId])
    add(['custom-resource', clusterId])
    add(qk.helmReleases(clusterId))
    add(['helm-revisions', clusterId])
  }

  const tasks = [...prefixes.values()].map((queryKey) => qc.invalidateQueries({ queryKey }))
  if (deletedNamespaces.size > 0) {
    tasks.push(
      qc.invalidateQueries({
        predicate: (query) =>
          query.queryKey[1] === clusterId &&
          deletedNamespaces.has(String(query.queryKey[3])) &&
          ['yaml', 'detail', 'config-data', 'events'].includes(String(query.queryKey[0]))
      })
    )
  }
  await Promise.allSettled(tasks)
}
