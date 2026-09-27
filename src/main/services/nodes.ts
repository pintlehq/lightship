import type { NodeDetail, NodeRow } from '../../shared/ipc-types'

import { kcForCluster, loadK8s } from './k8s-client'
import { nodeMetricsMap } from './node-metrics'
import { isReady } from './node-readiness'
import {
  ageOf,
  cpuToCores,
  fmtByteQuantity,
  fmtCpuQuantity,
  fmtGi,
  memoryToBytes
} from './quantities'
import { allocatedResourceRows, nodeResourceRows, sumRequests } from './resource-quantities'

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
    const cpuAlloc = cpuToCores(alloc.cpu)
    const memAlloc = memoryToBytes(alloc.memory)
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
  const cpuAlloc = cpuToCores(alloc.cpu)
  const memAlloc = memoryToBytes(alloc.memory)
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
