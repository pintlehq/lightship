import type {
  ClusterEvent,
  ClusterOverview,
  ConfigData,
  NodeDetail,
  OverviewBundle,
  ResourceDetail,
  ResourceRef,
  ResourceRow
} from '../../../shared/ipc-types'
import type { NodeRow, Pod } from '../types'
import { clusterApi, hasBackend } from '../lib/ipc'
import { generateNodes, generatePods } from './generate'
import { LIGHTSHIP_EVENTS } from './static'

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Mock fallbacks are used only when there's no Electron backend (plain browser /
// headless dev). In Electron, reads go to the active cluster via window.api.
let podsCache: Pod[] | undefined

export async function fetchPods(clusterId: string | null): Promise<Pod[]> {
  if (hasBackend()) return clusterId ? clusterApi.pods(clusterId) : []
  await delay(140)
  podsCache ??= generatePods(5000)
  return podsCache
}

const EMPTY_OVERVIEW: ClusterOverview = {
  nodes: 0,
  nodesReady: 0,
  pods: 0,
  podsCapacity: 0,
  cpuPct: null,
  memPct: null,
  cpuReqPct: 0,
  cpuRequest: '0.0 / 0.0',
  memReqPct: 0,
  memRequest: '0.0Gi / 0.0Gi',
  namespaces: 0
}
const MOCK_OVERVIEW: ClusterOverview = {
  nodes: 12,
  nodesReady: 12,
  pods: 384,
  podsCapacity: 440,
  cpuPct: 58,
  memPct: 71,
  cpuReqPct: 41,
  cpuRequest: '19.6 / 48.0',
  memReqPct: 63,
  memRequest: '121.0Gi / 192.0Gi',
  namespaces: 8
}

export async function fetchNodes(clusterId: string | null): Promise<NodeRow[]> {
  if (hasBackend()) return clusterId ? clusterApi.nodes(clusterId) : []
  await delay(120)
  return generateNodes(120)
}

// Mock node detail so the node detail view renders in a plain browser (no backend).
function mockNodeDetail(name: string): NodeDetail {
  return {
    name,
    created: new Date(Date.now() - 5 * 86400_000).toISOString(),
    labels: {
      'kubernetes.io/arch': 'amd64',
      'kubernetes.io/os': 'linux',
      'node.kubernetes.io/instance-type': 'ecs.g7.xlarge',
      'topology.kubernetes.io/zone': 'cn-hongkong-b'
    },
    annotations: { 'node.alpha.kubernetes.io/ttl': '0' },
    addresses: [{ type: 'InternalIP', address: '172.17.0.184' }],
    roles: ['worker'],
    os: 'linux',
    arch: 'amd64',
    osImage: 'Alibaba Cloud Linux Lifsea (ContainerOS) 3',
    kernelVersion: '5.10.134-19.4.1.lifsea8.x86_64',
    containerRuntime: 'containerd://2.1.6',
    kubeletVersion: 'v1.35.2-aliyun.1',
    zone: 'cn-hongkong-b',
    instanceType: 'ecs.g7.xlarge',
    conditions: [
      { type: 'SufficientIP', status: 'False' },
      { type: 'Ready', status: 'True' }
    ],
    capacity: [
      { resource: 'CPU', value: '4' },
      { resource: 'Memory', value: '30.8GiB' },
      { resource: 'Ephemeral Storage', value: '117.6GiB' },
      { resource: 'Hugepages-1Gi', value: '0' },
      { resource: 'Hugepages-2Mi', value: '0' },
      { resource: 'Pods', value: '48' }
    ],
    allocatable: [
      { resource: 'CPU', value: '3.92' },
      { resource: 'Memory', value: '29.8GiB' },
      { resource: 'Ephemeral Storage', value: '105.8GiB' },
      { resource: 'Hugepages-1Gi', value: '0' },
      { resource: 'Hugepages-2Mi', value: '0' },
      { resource: 'Pods', value: '48' }
    ],
    allocated: [
      { resource: 'CPU', requests: '1.8', requestsPct: 46, limits: '2.4', limitsPct: 61 },
      { resource: 'Memory', requests: '9.6GiB', requestsPct: 32, limits: '12.0GiB', limitsPct: 40 },
      { resource: 'Ephemeral Storage', requests: '0', requestsPct: 0, limits: '0', limitsPct: 0 },
      { resource: 'Hugepages-1Gi', requests: '0', requestsPct: 0, limits: '0', limitsPct: 0 },
      { resource: 'Hugepages-2Mi', requests: '0', requestsPct: 0, limits: '0', limitsPct: 0 },
      { resource: 'Pods', requests: '16', requestsPct: 33, limits: '—', limitsPct: null }
    ],
    cpuPct: 34,
    cpu: '1.4 / 4',
    memPct: 52,
    mem: '8.3Gi / 16.0Gi',
    cpuReqPct: 45,
    cpuRequest: '1.8 / 4',
    memReqPct: 60,
    memRequest: '9.6Gi / 16.0Gi'
  }
}

export async function fetchNodeDetail(clusterId: string | null, name: string): Promise<NodeDetail> {
  if (hasBackend()) {
    if (!clusterId) throw new Error('No active cluster')
    return clusterApi.nodeDetail(clusterId, name)
  }
  await delay(80)
  return mockNodeDetail(name)
}

export async function fetchOverview(clusterId: string | null): Promise<ClusterOverview> {
  if (hasBackend()) return clusterId ? clusterApi.overview(clusterId) : EMPTY_OVERVIEW
  await delay(80)
  return MOCK_OVERVIEW
}

export async function fetchOverviewBundle(clusterId: string | null): Promise<OverviewBundle> {
  if (hasBackend()) {
    return clusterId
      ? clusterApi.overviewBundle(clusterId)
      : { overview: EMPTY_OVERVIEW, events: [] }
  }
  const [overview, events] = await Promise.all([fetchOverview(clusterId), fetchEvents(clusterId)])
  return { overview, events }
}

export async function fetchEvents(
  clusterId: string | null,
  ref?: ResourceRef
): Promise<ClusterEvent[]> {
  if (hasBackend()) return clusterId ? clusterApi.events(clusterId, ref) : []
  await delay(60)
  return LIGHTSHIP_EVENTS.map((e) => ({
    type: e.type,
    reason: e.reason,
    object: e.obj,
    message: e.msg,
    age: e.age
  }))
}

export async function fetchResource(
  clusterId: string | null,
  kind: string
): Promise<ResourceRow[]> {
  if (hasBackend()) return clusterId ? clusterApi.listResource(clusterId, kind) : []
  await delay(80)
  return [] // no mock for generic resources in a plain browser
}

// A minimal manifest stand-in so the editor renders in a plain browser (no backend).
function mockYaml(ref: ResourceRef): string {
  const ns = ref.namespace ? `\n  namespace: ${ref.namespace}` : ''
  return [
    'apiVersion: v1',
    `kind: ${ref.kind}`,
    'metadata:',
    `  name: ${ref.name}${ns}`,
    '  labels:',
    '    app: checkout-api',
    'spec:',
    '  # live manifest is available when running inside the Electron app',
    '  replicas: 1',
    ''
  ].join('\n')
}

export async function fetchResourceYaml(
  clusterId: string | null,
  ref: ResourceRef
): Promise<string> {
  if (hasBackend()) {
    if (!clusterId) throw new Error('No active cluster')
    return clusterApi.getYaml(clusterId, ref)
  }
  await delay(80)
  return mockYaml(ref)
}

export async function applyResourceYaml(
  clusterId: string | null,
  ref: ResourceRef,
  yaml: string
): Promise<void> {
  if (!hasBackend())
    throw new Error('Backend unavailable — run inside the Electron app to apply changes')
  if (!clusterId) throw new Error('No active cluster')
  return clusterApi.applyYaml(clusterId, ref, yaml)
}

export async function createResourceYaml(clusterId: string | null, yaml: string): Promise<void> {
  if (!hasBackend())
    throw new Error('Backend unavailable — run inside the Electron app to create resources')
  if (!clusterId) throw new Error('No active cluster')
  return clusterApi.createYaml(clusterId, yaml)
}

// Mock detail so the Overview renders in a plain browser (no backend).
function mockDetail(ref: ResourceRef): ResourceDetail {
  const labels = { app: 'checkout-api', tier: 'backend', version: 'v2.4.1' }
  if (ref.kind !== 'pods') {
    const ports =
      ref.kind === 'services'
        ? [
            { name: 'http', port: 80, protocol: 'TCP' },
            { name: 'https', port: 443, protocol: 'TCP' }
          ]
        : [{ name: 'http', port: 8080, protocol: 'TCP' }]
    return { labels, ports }
  }
  return {
    labels,
    qosClass: 'Burstable',
    cpuLimit: '500m',
    memLimit: '1Gi',
    containers: [
      { name: 'app', image: 'checkout-api:v2.4.1', ready: true, state: 'Running', restarts: 0 },
      {
        name: 'sidecar-istio',
        image: 'istio/proxyv2:1.22',
        ready: true,
        state: 'Running',
        restarts: 0
      }
    ],
    ports: [
      { name: 'http', port: 8080, protocol: 'TCP' },
      { name: 'metrics', port: 9090, protocol: 'TCP' }
    ]
  }
}

export async function fetchResourceDetail(
  clusterId: string | null,
  ref: ResourceRef
): Promise<ResourceDetail> {
  if (hasBackend()) {
    if (!clusterId) throw new Error('No active cluster')
    return clusterApi.getResourceDetail(clusterId, ref)
  }
  await delay(80)
  return mockDetail(ref)
}

export async function fetchConfigData(
  clusterId: string | null,
  ref: ResourceRef
): Promise<ConfigData> {
  if (hasBackend()) {
    if (!clusterId) throw new Error('No active cluster')
    return clusterApi.getConfigData(clusterId, ref)
  }
  await delay(80)
  return {
    secret: ref.kind === 'secrets',
    data: { EXAMPLE_KEY: 'example-value', 'config.yaml': 'level: info\nreplicas: 3' },
    binaryKeys: []
  }
}

export async function applyConfigData(
  clusterId: string | null,
  ref: ResourceRef,
  data: Record<string, string>
): Promise<void> {
  if (!hasBackend())
    throw new Error('Backend unavailable — run inside the Electron app to apply changes')
  if (!clusterId) throw new Error('No active cluster')
  return clusterApi.applyConfigData(clusterId, ref, data)
}
