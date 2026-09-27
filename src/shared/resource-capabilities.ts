import { RESOURCE_CATALOG, type ResourceCapabilities } from './resource-catalog'
export type { ResourceCapabilities } from './resource-catalog'

export const RESOURCE_CAPABILITIES: Record<string, ResourceCapabilities> = Object.fromEntries(
  Object.entries(RESOURCE_CATALOG).map(([id, resource]) => [id, resource.capabilities])
)

export function resourceCapabilities(kind: string): ResourceCapabilities {
  return RESOURCE_CAPABILITIES[kind] ?? {}
}

export function canLogResource(kind: string): boolean {
  return resourceCapabilities(kind).loggable === true
}

export function canForwardResource(kind: string): boolean {
  return resourceCapabilities(kind).forwardable === true
}

export function canRestartResource(kind: string): boolean {
  return resourceCapabilities(kind).restartable === true
}

export function canScaleResource(kind: string): boolean {
  return resourceCapabilities(kind).scalable === true
}
