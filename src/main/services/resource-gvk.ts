import type { ResourceRef } from '../../shared/ipc-types'
import { RESOURCE_CATALOG } from '../../shared/resource-catalog'

export const GVK: Record<string, { apiVersion: string; kind: string; namespaced: boolean }> =
  Object.fromEntries(
    Object.entries(RESOURCE_CATALOG)
      // Node operations remain on their dedicated services. Catalog membership must
      // not enable new generic mutations (notably node deletion) during a refactor.
      .filter(([id]) => id !== 'nodes')
      .map(([id, { apiVersion, kind, namespaced }]) => [id, { apiVersion, kind, namespaced }])
  )

/** Resolve a ref to a GVK: the static table for built-in kinds, else the ref's own
 * `apiVersion`/`kind` for custom-resource instances. */
export function resolveGvk(
  ref: ResourceRef
): { apiVersion: string; kind: string; namespaced: boolean } | undefined {
  return (
    GVK[ref.kind] ??
    (ref.apiVersion
      ? { apiVersion: ref.apiVersion, kind: ref.kind, namespaced: ref.namespace != null }
      : undefined)
  )
}
