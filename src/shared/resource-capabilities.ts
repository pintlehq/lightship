export interface ResourceCapabilities {
  /** Workloads whose pods can be resolved for log streaming. */
  loggable?: boolean
  /** Resources that can be used as a port-forward target. */
  forwardable?: boolean
  /** Workloads that support a rollout restart patch. */
  restartable?: boolean
  /** Workloads that support a replica count patch. */
  scalable?: boolean
}

export const RESOURCE_CAPABILITIES: Record<string, ResourceCapabilities> = {
  deployments: { loggable: true, forwardable: true, restartable: true, scalable: true },
  statefulsets: { loggable: true, forwardable: true, restartable: true, scalable: true },
  daemonsets: { loggable: true, forwardable: true, restartable: true },
  jobs: { loggable: true, forwardable: true },
  cronjobs: { loggable: true },
  services: { forwardable: true }
}

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
