import type { KubernetesObject } from '@kubernetes/client-node'

import type { ContainerInfo, PortInfo, ResourceDetail, ResourceRef } from '../../shared/ipc-types'
import { kcForCluster, loadK8s } from './k8s-client'
import { resolveGvk } from './resource-gvk'
import { objectApi } from './resource-mutations'

import { cpuToMillicores, formatCpu, formatMem, memoryToRoundedBytes } from './quantities'

/** Dedup ports by number, dropping zero/unset. */
function dedupePorts(ports: PortInfo[]): PortInfo[] {
  const seen = new Set<number>()
  const out: PortInfo[] = []
  for (const p of ports) {
    if (p.port > 0 && !seen.has(p.port)) {
      seen.add(p.port)
      out.push(p)
    }
  }
  return out
}

// Minimal view over the bits of a workload/service we read for ports.
type WithPorts = {
  spec?: {
    ports?: { name?: string; port?: number; protocol?: string }[]
    template?: {
      spec?: {
        containers?: { ports?: { name?: string; containerPort?: number; protocol?: string }[] }[]
      }
    }
  }
}

/** Live object fields for a resource's Overview tab. Pods carry containers/QoS/limits. */
export async function getResourceDetail(
  clusterId: string,
  ref: ResourceRef
): Promise<ResourceDetail> {
  if (ref.kind === 'pods') {
    const { CoreV1Api } = await loadK8s()
    const kc = await kcForCluster(clusterId)
    const p = await kc
      .makeApiClient(CoreV1Api)
      .readNamespacedPod({ name: ref.name, namespace: ref.namespace ?? 'default' })

    const statuses = p.status?.containerStatuses ?? []
    const containers: ContainerInfo[] = (p.spec?.containers ?? []).map((c) => {
      const st = statuses.find((s) => s.name === c.name)
      const state = st?.state?.running
        ? 'Running'
        : (st?.state?.waiting?.reason ?? st?.state?.terminated?.reason ?? 'Unknown')
      return {
        name: c.name,
        image: c.image ?? '',
        ready: st?.ready ?? false,
        state,
        restarts: st?.restartCount ?? 0
      }
    })

    let cpuM = 0
    let memB = 0
    let hasCpu = false
    let hasMem = false
    for (const c of p.spec?.containers ?? []) {
      const lim = c.resources?.limits
      if (lim?.cpu) {
        cpuM += cpuToMillicores(lim.cpu)
        hasCpu = true
      }
      if (lim?.memory) {
        memB += memoryToRoundedBytes(lim.memory)
        hasMem = true
      }
    }

    const ports = dedupePorts(
      (p.spec?.containers ?? [])
        .flatMap((c) => c.ports ?? [])
        .map((cp) => ({ name: cp.name, port: cp.containerPort, protocol: cp.protocol }))
    )

    return {
      labels: p.metadata?.labels ?? {},
      qosClass: p.status?.qosClass,
      cpuLimit: hasCpu ? formatCpu(cpuM) : undefined,
      memLimit: hasMem ? formatMem(memB) : undefined,
      containers,
      ports: ports.length ? ports : undefined
    }
  }

  const gvk = resolveGvk(ref)
  if (!gvk) throw new Error(`Unknown resource kind: ${ref.kind}`)
  const obj = await objectApi(clusterId)
  const live = (await obj.read({
    apiVersion: gvk.apiVersion,
    kind: gvk.kind,
    metadata: { name: ref.name, namespace: gvk.namespaced ? ref.namespace : undefined }
  })) as KubernetesObject &
    WithPorts & {
      metadata?: {
        creationTimestamp?: string | Date
        finalizers?: string[]
        labels?: Record<string, string>
      }
      status?: { conditions?: Array<{ type?: string; status?: string; reason?: string }> }
    }

  const ports =
    ref.kind === 'services'
      ? dedupePorts(
          (live.spec?.ports ?? []).map((p) => ({
            name: p.name,
            port: p.port ?? 0,
            protocol: p.protocol
          }))
        )
      : dedupePorts(
          (live.spec?.template?.spec?.containers ?? [])
            .flatMap((c) => c.ports ?? [])
            .map((cp) => ({ name: cp.name, port: cp.containerPort ?? 0, protocol: cp.protocol }))
        )

  const ts = live.metadata?.creationTimestamp
  const finalizers = live.metadata?.finalizers ?? []
  const conditions = (live.status?.conditions ?? [])
    .map((c) => ({ type: c.type ?? '', status: c.status ?? '', reason: c.reason }))
    .filter((c) => c.type)

  return {
    labels: live.metadata?.labels ?? {},
    ports: ports.length ? ports : undefined,
    created: ts ? String(ts) : undefined,
    finalizers: finalizers.length ? finalizers : undefined,
    conditions: conditions.length ? conditions : undefined
  }
}
