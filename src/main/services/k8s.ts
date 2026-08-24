import type { KubeConfig } from '@kubernetes/client-node'

import type {
  ClusterAddSelection,
  ClusterEvent,
  ClusterMeta,
  ClusterOverview,
  DetectedContext,
  NodeDetail,
  NodeRow,
  OverviewBundle,
  ResourceRef,
  TestResult
} from '../../shared/ipc-types'
import { listClusters, readKubeconfig, saveCluster } from './cluster-store'

// @kubernetes/client-node is ESM-only; the main process is CJS, so load it via
// a memoised dynamic import inside async code.
type K8sModule = typeof import('@kubernetes/client-node')
let modPromise: Promise<K8sModule> | undefined
export const loadK8s = (): Promise<K8sModule> => (modPromise ??= import('@kubernetes/client-node'))

const kcCache = new Map<string, KubeConfig>()

export function invalidate(clusterId?: string): void {
  if (clusterId) kcCache.delete(clusterId)
  else kcCache.clear()
}

/** KubeConfig for a stored cluster (cached). Exported for later phases. */
export async function kcForCluster(clusterId: string): Promise<KubeConfig> {
  const cached = kcCache.get(clusterId)
  if (cached) return cached
  const { KubeConfig } = await loadK8s()
  const kc = new KubeConfig()
  kc.loadFromString(await readKubeconfig(clusterId))
  kcCache.set(clusterId, kc)
  return kc
}

function mapContexts(kc: KubeConfig): DetectedContext[] {
  return kc.getContexts().map((ctx) => ({
    name: ctx.name,
    cluster: ctx.cluster,
    user: ctx.user,
    server: kc.getCluster(ctx.cluster)?.server ?? ''
  }))
}

async function withAddedFlags(contexts: DetectedContext[]): Promise<DetectedContext[]> {
  const existing = new Set((await listClusters()).map((c) => c.context))
  return contexts.map((c) => ({ ...c, alreadyAdded: existing.has(c.name) }))
}

export async function detectKubeconfigContexts(): Promise<DetectedContext[]> {
  const { KubeConfig } = await loadK8s()
  const kc = new KubeConfig()
  try {
    kc.loadFromDefault()
  } catch {
    return []
  }
  return withAddedFlags(mapContexts(kc))
}

export async function parseKubeconfig(yaml: string): Promise<DetectedContext[]> {
  const { KubeConfig } = await loadK8s()
  const kc = new KubeConfig()
  kc.loadFromString(yaml)
  return withAddedFlags(mapContexts(kc))
}

export async function addClusters(selections: ClusterAddSelection[]): Promise<ClusterMeta[]> {
  const { KubeConfig } = await loadK8s()
  const added: ClusterMeta[] = []
  for (const sel of selections) {
    const src = new KubeConfig()
    if (sel.kubeconfig) src.loadFromString(sel.kubeconfig)
    else src.loadFromDefault()
    const ctx = src.getContextObject(sel.context)
    if (!ctx) continue
    const cluster = src.getCluster(ctx.cluster)
    const user = src.getUser(ctx.user)
    // Export a minimal kubeconfig with only this context's cluster/user.
    const mini = new KubeConfig()
    mini.loadFromOptions({
      clusters: cluster ? [cluster] : [],
      users: user ? [user] : [],
      contexts: [ctx],
      currentContext: ctx.name
    })
    const meta = await saveCluster(
      { name: ctx.name, context: ctx.name, server: cluster?.server ?? '' },
      mini.exportConfig()
    )
    added.push(meta)
  }
  return added
}

export async function testConnection(clusterId: string): Promise<TestResult> {
  try {
    const kc = await kcForCluster(clusterId)
    const { VersionApi } = await loadK8s()
    const info = await kc.makeApiClient(VersionApi).getCode()
    return { ok: true, version: info.gitVersion ?? `${info.major}.${info.minor}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// --- quantity / formatting helpers ---------------------------------------

/** CPU quantity → cores ("250m" → 0.25, "500n" → 5e-7, "2" → 2). */
export function parseCpu(v?: string): number {
  if (!v) return 0
  if (v.endsWith('n')) return parseFloat(v) / 1e9
  if (v.endsWith('u')) return parseFloat(v) / 1e6
  if (v.endsWith('m')) return parseFloat(v) / 1e3
  return parseFloat(v) || 0
}

const MEM_UNITS: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12
}
/** Memory quantity → bytes ("1Gi" → 2^30, "512Mi" → …, bare number passthrough). */
export function parseMem(v?: string): number {
  if (!v) return 0
  const m = /^(\d+(?:\.\d+)?)([A-Za-z]+)?$/.exec(v)
  if (!m) return parseFloat(v) || 0
  const n = parseFloat(m[1])
  return m[2] ? n * (MEM_UNITS[m[2]] ?? 1) : n
}
const fmtGi = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)}Gi`
const fmtGiB = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)}GiB`
const trimFixed = (n: number, digits: number): string => {
  const fixed = n.toFixed(digits)
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}
const fmtCpuQuantity = (cores: number): string => {
  if (!cores) return '0'
  if (cores < 1) return `${trimFixed(cores * 1000, 1)}m`
  return trimFixed(cores, 2)
}
const fmtByteQuantity = (bytes: number): string => {
  if (!bytes) return '0'
  if (bytes < 1024 ** 2) return `${trimFixed(bytes / 1024, 1)}KiB`
  if (bytes < 1024 ** 3) return `${trimFixed(bytes / 1024 ** 2, 1)}MiB`
  return fmtGiB(bytes)
}

export function ageOf(ts?: Date | string): string {
  if (!ts) return ''
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000))
  const d = Math.floor(s / 86400)
  if (d) return `${d}d`
  const h = Math.floor(s / 3600)
  if (h) return `${h}h`
  const m = Math.floor(s / 60)
  if (m) return `${m}m`
  return `${s}s`
}

const isReady = (conditions?: Array<{ type?: string; status?: string }>): boolean =>
  (conditions ?? []).some((c) => c.type === 'Ready' && c.status === 'True')

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
  if (resource === 'cpu') return parseCpu(value)
  if (resource === 'pods') return Number(value) || 0
  return parseMem(value)
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

function sumRequests(pods: PodLike[]): { cpu: number; mem: number } {
  const req = sumPodResources(pods, 'requests')
  return { cpu: req.cpu ?? 0, mem: req.memory ?? 0 }
}

function nodeResourceRows(resources: ResourceListLike) {
  return NODE_RESOURCE_KEYS.map(({ key, label }) => ({
    resource: label,
    value: formatNodeResource(key, resources[key])
  }))
}

function allocatedResourceRows(pods: PodLike[], allocatable: ResourceListLike) {
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

async function nodeMetricsMap(
  kc: KubeConfig
): Promise<Record<string, { cpu: number; mem: number }>> {
  try {
    const { Metrics } = await loadK8s()
    const top = await new Metrics(kc).getNodeMetrics()
    const out: Record<string, { cpu: number; mem: number }> = {}
    for (const it of top.items) {
      out[it.metadata?.name ?? ''] = {
        cpu: parseCpu(it.usage?.cpu),
        mem: parseMem(it.usage?.memory)
      }
    }
    return out
  } catch {
    return {} // metrics-server not installed
  }
}

export async function listNodes(clusterId: string): Promise<NodeRow[]> {
  const kc = await kcForCluster(clusterId)
  const { CoreV1Api } = await loadK8s()
  const core = kc.makeApiClient(CoreV1Api)
  const [nodesRes, podsRes, metrics] = await Promise.all([
    core.listNode(),
    core.listPodForAllNamespaces(),
    nodeMetricsMap(kc)
  ])
  const podsByNode: Record<string, number> = {}
  for (const p of podsRes.items) {
    const n = p.spec?.nodeName
    if (n) podsByNode[n] = (podsByNode[n] ?? 0) + 1
  }
  return nodesRes.items.map((n): NodeRow => {
    const name = n.metadata?.name ?? ''
    const labels = n.metadata?.labels ?? {}
    const cp = Object.keys(labels).some(
      (k) =>
        k.startsWith('node-role.kubernetes.io/control-plane') ||
        k.startsWith('node-role.kubernetes.io/master')
    )
    const alloc = n.status?.allocatable ?? {}
    const cpuAlloc = parseCpu(alloc.cpu)
    const memAlloc = parseMem(alloc.memory)
    const usage = metrics[name]
    return {
      name,
      roles: cp ? ['control-plane'] : ['worker'],
      status: isReady(n.status?.conditions) ? 'Ready' : 'NotReady',
      cpuPct: usage && cpuAlloc ? Math.round((usage.cpu / cpuAlloc) * 100) : 0,
      cpu: `${usage ? usage.cpu.toFixed(1) : '0'} / ${cpuAlloc}`,
      memPct: usage && memAlloc ? Math.round((usage.mem / memAlloc) * 100) : 0,
      mem: `${usage ? fmtGi(usage.mem) : '0'} / ${fmtGi(memAlloc)}`,
      pods: podsByNode[name] ?? 0,
      maxPods: Number(alloc.pods ?? 0),
      ver: n.status?.nodeInfo?.kubeletVersion ?? '',
      zone:
        labels['topology.kubernetes.io/zone'] ??
        labels['failure-domain.beta.kubernetes.io/zone'] ??
        '',
      type:
        labels['node.kubernetes.io/instance-type'] ??
        labels['beta.kubernetes.io/instance-type'] ??
        '',
      age: ageOf(n.metadata?.creationTimestamp),
      ip: (n.status?.addresses ?? []).find((a) => a.type === 'InternalIP')?.address ?? '',
      taint: (n.spec?.taints ?? [])[0]?.effect,
      cordoned: n.spec?.unschedulable ?? false
    }
  })
}

/** Full detail for a single node, plus its point-in-time CPU/memory usage. */
export async function getNodeDetail(clusterId: string, name: string): Promise<NodeDetail> {
  const kc = await kcForCluster(clusterId)
  const { CoreV1Api } = await loadK8s()
  const core = kc.makeApiClient(CoreV1Api)
  const [n, metrics, podsRes] = await Promise.all([
    core.readNode({ name }),
    nodeMetricsMap(kc),
    core.listPodForAllNamespaces({ fieldSelector: `spec.nodeName=${name}` })
  ])
  const labels = n.metadata?.labels ?? {}
  const info = n.status?.nodeInfo
  const capacity = n.status?.capacity ?? {}
  const alloc = n.status?.allocatable ?? {}
  const cpuAlloc = parseCpu(alloc.cpu)
  const memAlloc = parseMem(alloc.memory)
  const usage = metrics[name]
  const req = sumRequests(podsRes.items)
  const cp = Object.keys(labels).some(
    (k) =>
      k.startsWith('node-role.kubernetes.io/control-plane') ||
      k.startsWith('node-role.kubernetes.io/master')
  )
  return {
    name,
    created: n.metadata?.creationTimestamp
      ? new Date(n.metadata.creationTimestamp).toISOString()
      : '',
    labels,
    annotations: n.metadata?.annotations ?? {},
    addresses: (n.status?.addresses ?? []).map((a) => ({
      type: a.type ?? '',
      address: a.address ?? ''
    })),
    roles: cp ? ['control-plane'] : ['worker'],
    os: info?.operatingSystem ?? '',
    arch: info?.architecture ?? '',
    osImage: info?.osImage ?? '',
    kernelVersion: info?.kernelVersion ?? '',
    containerRuntime: info?.containerRuntimeVersion ?? '',
    kubeletVersion: info?.kubeletVersion ?? '',
    zone:
      labels['topology.kubernetes.io/zone'] ??
      labels['failure-domain.beta.kubernetes.io/zone'] ??
      '',
    instanceType:
      labels['node.kubernetes.io/instance-type'] ??
      labels['beta.kubernetes.io/instance-type'] ??
      '',
    conditions: (n.status?.conditions ?? []).map((c) => ({
      type: c.type ?? '',
      status: c.status ?? '',
      reason: c.reason ?? undefined
    })),
    capacity: nodeResourceRows(capacity),
    allocatable: nodeResourceRows(alloc),
    allocated: allocatedResourceRows(podsRes.items, alloc),
    cpuPct: usage && cpuAlloc ? Math.round((usage.cpu / cpuAlloc) * 100) : 0,
    cpu: `${usage ? usage.cpu.toFixed(1) : '0'} / ${cpuAlloc}`,
    memPct: usage && memAlloc ? Math.round((usage.mem / memAlloc) * 100) : 0,
    mem: `${usage ? fmtGi(usage.mem) : '0'} / ${fmtGi(memAlloc)}`,
    cpuReqPct: cpuAlloc ? Math.round((req.cpu / cpuAlloc) * 100) : 0,
    cpuRequest: `${fmtCpuQuantity(req.cpu)} / ${fmtCpuQuantity(cpuAlloc)}`,
    memReqPct: memAlloc ? Math.round((req.mem / memAlloc) * 100) : 0,
    memRequest: `${fmtByteQuantity(req.mem)} / ${fmtByteQuantity(memAlloc)}`
  }
}

export async function getOverview(clusterId: string): Promise<ClusterOverview> {
  const kc = await kcForCluster(clusterId)
  const { CoreV1Api } = await loadK8s()
  const core = kc.makeApiClient(CoreV1Api)
  const [nodesRes, podsRes, nsRes] = await Promise.all([
    core.listNode(),
    core.listPodForAllNamespaces(),
    core.listNamespace()
  ])
  const nodes = nodesRes.items
  const nodesReady = nodes.filter((n) => isReady(n.status?.conditions)).length
  const podsCapacity = nodes.reduce((a, n) => a + Number(n.status?.allocatable?.pods ?? 0), 0)

  // Allocatable totals — needed for both usage% (metrics) and request% (always).
  const capCpu = nodes.reduce((a, n) => a + parseCpu(n.status?.allocatable?.cpu), 0)
  const capMem = nodes.reduce((a, n) => a + parseMem(n.status?.allocatable?.memory), 0)

  let cpuPct: number | null = null
  let memPct: number | null = null
  const metrics = await nodeMetricsMap(kc)
  if (Object.keys(metrics).length) {
    const useCpu = Object.values(metrics).reduce((a, m) => a + m.cpu, 0)
    const useMem = Object.values(metrics).reduce((a, m) => a + m.mem, 0)
    cpuPct = capCpu ? Math.round((useCpu / capCpu) * 100) : null
    memPct = capMem ? Math.round((useMem / capMem) * 100) : null
  }

  // Requested resources (sum of pod requests) — independent of metrics-server.
  const req = sumRequests(podsRes.items)

  return {
    nodes: nodes.length,
    nodesReady,
    pods: podsRes.items.length,
    podsCapacity,
    cpuPct,
    memPct,
    cpuReqPct: capCpu ? Math.round((req.cpu / capCpu) * 100) : 0,
    cpuRequest: `${req.cpu.toFixed(1)} / ${capCpu.toFixed(1)}`,
    memReqPct: capMem ? Math.round((req.mem / capMem) * 100) : 0,
    memRequest: `${fmtGi(req.mem)} / ${fmtGi(capMem)}`,
    namespaces: nsRes.items.length
  }
}

export async function buildOverviewBundle(
  overview: () => Promise<ClusterOverview>,
  events: () => Promise<ClusterEvent[]>
): Promise<OverviewBundle> {
  const [overviewResult, eventRows] = await Promise.all([overview(), events()])
  return { overview: overviewResult, events: eventRows }
}

export async function getOverviewBundle(clusterId: string): Promise<OverviewBundle> {
  return buildOverviewBundle(
    () => getOverview(clusterId),
    () => listEvents(clusterId)
  )
}

/** Recent cluster events, newest first (capped). With `ref`, only that object's
 *  events (filtered server-side); otherwise cluster-wide across all namespaces. */
export async function listEvents(clusterId: string, ref?: ResourceRef): Promise<ClusterEvent[]> {
  const kc = await kcForCluster(clusterId)
  const { CoreV1Api } = await loadK8s()
  const core = kc.makeApiClient(CoreV1Api)
  const res = ref
    ? await core.listNamespacedEvent({
        namespace: ref.namespace ?? 'default',
        fieldSelector: `involvedObject.name=${ref.name}`
      })
    : await core.listEventForAllNamespaces()
  const at = (e: (typeof res.items)[number]): number => {
    const ts = e.lastTimestamp ?? e.eventTime ?? e.metadata?.creationTimestamp
    return ts ? new Date(ts).getTime() : 0
  }
  return res.items
    .slice()
    .sort((a, b) => at(b) - at(a))
    .slice(0, 50)
    .map((e) => ({
      type: e.type ?? 'Normal',
      reason: e.reason ?? '',
      object: `${e.involvedObject?.kind ?? ''}/${e.involvedObject?.name ?? ''}`,
      message: e.message ?? '',
      age: ageOf(e.lastTimestamp ?? e.eventTime ?? e.metadata?.creationTimestamp)
    }))
}
