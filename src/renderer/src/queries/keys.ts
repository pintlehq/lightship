import type { CustomResourceParams, ResourceRef } from '../../../shared/ipc-types'

export const qk = {
  pods: (clusterId?: string | null) => ['pods', clusterId ?? null] as const,
  nodes: (clusterId?: string | null) => ['nodes', clusterId ?? null] as const,
  namespaceSummaries: (clusterId?: string | null) =>
    ['namespace-summaries', clusterId ?? null] as const,
  namespaceDetail: (clusterId: string | null, name: string) =>
    ['namespace-detail', clusterId ?? null, name] as const,
  nodeDetail: (clusterId: string | null, name: string) =>
    ['node-detail', clusterId ?? null, name] as const,
  overview: (clusterId?: string | null) => ['overview', clusterId ?? null] as const,
  overviewBundle: (clusterId?: string | null) => ['overview-bundle', clusterId ?? null] as const,
  resource: (clusterId: string | null, kind: string) =>
    ['resource', clusterId ?? null, kind] as const,
  yaml: (clusterId: string | null, ref: ResourceRef) =>
    ['yaml', clusterId ?? null, ref.kind, ref.namespace ?? null, ref.name] as const,
  detail: (clusterId: string | null, ref: ResourceRef) =>
    ['detail', clusterId ?? null, ref.kind, ref.namespace ?? null, ref.name] as const,
  configData: (clusterId: string | null, ref: ResourceRef) =>
    ['config-data', clusterId ?? null, ref.kind, ref.namespace ?? null, ref.name] as const,
  clusters: () => ['clusters'] as const,
  events: (clusterId?: string | null, ref?: ResourceRef) =>
    [
      'events',
      clusterId ?? null,
      ref?.kind ?? null,
      ref?.namespace ?? null,
      ref?.name ?? null
    ] as const,
  customResource: (clusterId: string | null, p: CustomResourceParams) =>
    ['custom-resource', clusterId ?? null, p.group, p.version, p.plural] as const,
  helmReleases: (clusterId?: string | null) => ['helm-releases', clusterId ?? null] as const,
  helmRevisions: (clusterId: string | null, namespace: string, name: string) =>
    ['helm-revisions', clusterId ?? null, namespace, name] as const
}
