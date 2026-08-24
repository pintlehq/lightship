import { createServer, type Server, type Socket } from 'node:net'
import type { WebContents } from 'electron'
import type { KubeConfig, V1Pod } from '@kubernetes/client-node'

import type { PortForwardEvent, PortForwardOptions, ResourceRef } from '../../shared/ipc-types'
import { kcForCluster, loadK8s } from './k8s'

type Session = { server: Server; sockets: Set<Socket> }
const sessions = new Map<string, Session>()

const selectorString = (labels?: Record<string, string>): string =>
  Object.entries(labels ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(',')

const isReady = (p: V1Pod): boolean =>
  p.status?.phase === 'Running' &&
  (p.status?.conditions ?? []).some((c) => c.type === 'Ready' && c.status === 'True')

const pickPod = (pods: V1Pod[]): V1Pod | undefined => pods.find(isReady) ?? pods[0]

/** Pods backing a workload, via its label selector (like services/logs.ts). */
async function workloadPods(kc: KubeConfig, ref: ResourceRef, ns: string): Promise<V1Pod[]> {
  const k8s = await loadK8s()
  const core = kc.makeApiClient(k8s.CoreV1Api)
  const bySelector = async (labels?: Record<string, string>): Promise<V1Pod[]> => {
    const labelSelector = selectorString(labels)
    if (!labelSelector) return []
    return (await core.listNamespacedPod({ namespace: ns, labelSelector })).items
  }
  switch (ref.kind) {
    case 'deployments': {
      const d = await kc
        .makeApiClient(k8s.AppsV1Api)
        .readNamespacedDeployment({ name: ref.name, namespace: ns })
      return bySelector(d.spec?.selector?.matchLabels)
    }
    case 'statefulsets': {
      const s = await kc
        .makeApiClient(k8s.AppsV1Api)
        .readNamespacedStatefulSet({ name: ref.name, namespace: ns })
      return bySelector(s.spec?.selector?.matchLabels)
    }
    case 'daemonsets': {
      const d = await kc
        .makeApiClient(k8s.AppsV1Api)
        .readNamespacedDaemonSet({ name: ref.name, namespace: ns })
      return bySelector(d.spec?.selector?.matchLabels)
    }
    case 'jobs': {
      const j = await kc
        .makeApiClient(k8s.BatchV1Api)
        .readNamespacedJob({ name: ref.name, namespace: ns })
      return bySelector(j.spec?.selector?.matchLabels)
    }
    default:
      return []
  }
}

/** Resolve a ref + remote port to a concrete backing pod + pod port. */
async function resolveTarget(
  kc: KubeConfig,
  ref: ResourceRef,
  remotePort: number
): Promise<{ ns: string; pod: string; podPort: number }> {
  const k8s = await loadK8s()
  const ns = ref.namespace ?? 'default'

  if (ref.kind === 'pods') return { ns, pod: ref.name, podPort: remotePort }

  if (ref.kind === 'services') {
    const core = kc.makeApiClient(k8s.CoreV1Api)
    const svc = await core.readNamespacedService({ name: ref.name, namespace: ns })
    const labelSelector = selectorString(svc.spec?.selector)
    if (!labelSelector) throw new Error('Service has no selector to resolve pods')
    const pod = pickPod((await core.listNamespacedPod({ namespace: ns, labelSelector })).items)
    if (!pod) throw new Error('No ready pods backing this service')
    const sp = (svc.spec?.ports ?? []).find((p) => p.port === remotePort) ?? svc.spec?.ports?.[0]
    const tp = sp?.targetPort
    let podPort = remotePort
    if (typeof tp === 'number') podPort = tp
    else if (typeof tp === 'string') {
      const named = (pod.spec?.containers ?? [])
        .flatMap((c) => c.ports ?? [])
        .find((cp) => cp.name === tp)
      podPort = named?.containerPort ?? remotePort
    }
    return { ns, pod: pod.metadata?.name ?? '', podPort }
  }

  const pod = pickPod(await workloadPods(kc, ref, ns))
  if (!pod) throw new Error('No pods found for this resource')
  return { ns, pod: pod.metadata?.name ?? '', podPort: remotePort }
}

/** Open a local TCP listener that proxies to the resolved pod port via the
 *  Kubernetes API. Pushes status on `cluster:pf:<id>`. Idempotent per id. */
export async function startPortForward(
  sender: WebContents,
  id: string,
  clusterId: string,
  ref: ResourceRef,
  opts: PortForwardOptions
): Promise<void> {
  stopPortForward(id)
  const send = (ev: PortForwardEvent): void => {
    if (!sender.isDestroyed()) sender.send(`cluster:pf:${id}`, ev)
  }
  try {
    const kc = await kcForCluster(clusterId)
    const { PortForward } = await loadK8s()
    const { ns, pod, podPort } = await resolveTarget(kc, ref, opts.remotePort)
    const pf = new PortForward(kc)
    const sockets = new Set<Socket>()

    const server = createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', () => {})
      void pf.portForward(ns, pod, [podPort], socket, null, socket).catch(() => socket.destroy())
    })
    server.on('error', (e) => {
      send({ type: 'error', message: e instanceof Error ? e.message : String(e) })
      stopPortForward(id)
    })
    server.listen(opts.localPort || 0, '127.0.0.1', () => {
      const addr = server.address()
      send({ type: 'running', localPort: typeof addr === 'object' && addr ? addr.port : 0 })
    })

    sessions.set(id, { server, sockets })
    sender.once('destroyed', () => stopPortForward(id))
  } catch (e) {
    send({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

export function stopPortForward(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  for (const sock of s.sockets) {
    try {
      sock.destroy()
    } catch {
      /* already gone */
    }
  }
  try {
    s.server.close()
  } catch {
    /* already closed */
  }
}
