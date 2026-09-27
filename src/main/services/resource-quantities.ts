import { cpuToCores, fmtByteQuantity, fmtCpuQuantity, memoryToBytes, trimFixed } from './quantities'

const NODE_RESOURCE_KEYS = [
  { key: 'cpu', label: 'CPU' },
  { key: 'memory', label: 'Memory' },
  { key: 'ephemeral-storage', label: 'Ephemeral Storage' },
  { key: 'hugepages-1Gi', label: 'Hugepages-1Gi' },
  { key: 'hugepages-2Mi', label: 'Hugepages-2Mi' },
  { key: 'pods', label: 'Pods' }
] as const
type ResourceListLike = Record<string, string | undefined>
type ResourceTotals = Record<string, number>
type PodLike = {
  spec?: {
    containers?: { resources?: { requests?: ResourceListLike; limits?: ResourceListLike } }[]
    initContainers?: { resources?: { requests?: ResourceListLike; limits?: ResourceListLike } }[]
    overhead?: ResourceListLike
  }
}

function parseResourceQuantity(resource: string, value?: string): number {
  if (!value) return 0
  if (resource === 'cpu') return cpuToCores(value)
  if (resource === 'pods') return Number(value) || 0
  return memoryToBytes(value)
}

function formatResourceQuantity(resource: string, value: number): string {
  if (resource === 'cpu') return fmtCpuQuantity(value)
  if (resource === 'pods') return trimFixed(value, 0)
  return fmtByteQuantity(value)
}

function formatNodeResource(resource: string, value?: string): string {
  return formatResourceQuantity(resource, parseResourceQuantity(resource, value))
}

function pctOf(value: number, total: number): number | null {
  return total ? Math.round((value / total) * 100) : null
}

function addQuantity(out: ResourceTotals, resource: string, value?: string): void {
  if (!value) return
  out[resource] = (out[resource] ?? 0) + parseResourceQuantity(resource, value)
}

function addResourceList(out: ResourceTotals, resources?: ResourceListLike): void {
  for (const [resource, value] of Object.entries(resources ?? {})) addQuantity(out, resource, value)
}

function maxResourceList(out: ResourceTotals, resources?: ResourceListLike): void {
  for (const [resource, value] of Object.entries(resources ?? {})) {
    out[resource] = Math.max(out[resource] ?? 0, parseResourceQuantity(resource, value))
  }
}

function effectivePodResources(pod: PodLike, field: 'requests' | 'limits'): ResourceTotals {
  const app: ResourceTotals = {}
  const init: ResourceTotals = {}

  for (const c of pod.spec?.containers ?? []) addResourceList(app, c.resources?.[field])
  for (const c of pod.spec?.initContainers ?? []) maxResourceList(init, c.resources?.[field])

  const out: ResourceTotals = {}
  const resources = new Set([...Object.keys(app), ...Object.keys(init)])
  for (const resource of resources)
    out[resource] = Math.max(app[resource] ?? 0, init[resource] ?? 0)

  addResourceList(out, pod.spec?.overhead)
  return out
}

function sumPodResources(pods: PodLike[], field: 'requests' | 'limits'): ResourceTotals {
  const out: ResourceTotals = {}
  for (const pod of pods) {
    const effective = effectivePodResources(pod, field)
    for (const [resource, value] of Object.entries(effective))
      out[resource] = (out[resource] ?? 0) + value
  }
  return out
}

export function sumRequests(pods: PodLike[]): { cpu: number; mem: number } {
  const req = sumPodResources(pods, 'requests')
  return { cpu: req.cpu ?? 0, mem: req.memory ?? 0 }
}

export function nodeResourceRows(resources: ResourceListLike) {
  return NODE_RESOURCE_KEYS.map(({ key, label }) => ({
    resource: label,
    value: formatNodeResource(key, resources[key])
  }))
}

export function allocatedResourceRows(pods: PodLike[], allocatable: ResourceListLike) {
  const requests = sumPodResources(pods, 'requests')
  const limits = sumPodResources(pods, 'limits')
  requests.pods = pods.length

  return NODE_RESOURCE_KEYS.map(({ key, label }) => {
    const capacity = parseResourceQuantity(key, allocatable[key])
    const request = requests[key] ?? 0
    const limit = limits[key] ?? 0
    return {
      resource: label,
      requests: formatResourceQuantity(key, request),
      requestsPct: pctOf(request, capacity),
      limits: key === 'pods' ? '—' : formatResourceQuantity(key, limit),
      limitsPct: key === 'pods' ? null : pctOf(limit, capacity)
    }
  })
}
