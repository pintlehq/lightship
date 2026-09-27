import type { ResourceRef } from '../../../shared/ipc-types'

/** Keep namespace/name positions stable for query-prefix invalidation. */
export function resourceIdentity(clusterId: string | null, ref?: ResourceRef) {
  return [
    clusterId,
    ref?.kind ?? null,
    ref?.namespace ?? null,
    ref?.name ?? null,
    ref?.apiVersion ?? null
  ] as const
}

export function resourceTabId(clusterId: string, ref: ResourceRef): string {
  return `detail:${JSON.stringify(resourceIdentity(clusterId, ref))}`
}
