import type { ClusterEvent, ClusterOverview, OverviewBundle } from '../../shared/ipc-types'

import { listEvents } from './events'
import { kcForCluster, loadK8s } from './k8s-client'
import { nodeMetricsMap } from './node-metrics'
import { isReady } from './node-readiness'
import { cpuToCores, fmtGi, memoryToBytes } from './quantities'
import { sumRequests } from './resource-quantities'

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
  const capCpu = nodes.reduce((a, n) => a + cpuToCores(n.status?.allocatable?.cpu), 0)
  const capMem = nodes.reduce((a, n) => a + memoryToBytes(n.status?.allocatable?.memory), 0)

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
