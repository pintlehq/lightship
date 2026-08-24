// Helpers for remembering a resource detail view's active sub-tab per resource.

/**
 * Stable per-resource key for the remembered sub-tab. Pipe-separated; k8s
 * names/namespaces match `[a-z0-9.-]` and cluster ids are UUIDs, so none contain
 * `|`. Cluster-scoped resources (no namespace) get an empty namespace segment.
 *
 * Keyed by identity (cluster/kind/namespace/name) rather than the content-tab id
 * — tab ids embed an ephemeral uid and tabs don't persist, so they can't survive
 * an app restart.
 */
export function detailTabKey(
  clusterId: string | null,
  kind: string,
  namespace: string | undefined,
  name: string
): string {
  return `${clusterId ?? ''}|${kind}|${namespace ?? ''}|${name}`
}

/**
 * Resolve the sub-tab to show: the remembered one if it's still available, else
 * `'overview'`. Guards against a remembered tab that no longer exists for the
 * resource (e.g. a workload that stopped being loggable, or a kind change).
 */
export function resolveDetailTab(remembered: string | undefined, available: string[]): string {
  return remembered && available.includes(remembered) ? remembered : 'overview'
}
