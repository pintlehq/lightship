import { createServer, type Server, type Socket } from 'node:net'
import type { WebContents } from 'electron'
import {
  Observable,
  type ConfigurationOptions,
  type KubeConfig,
  type PortForward,
  type RequestContext,
  type ResponseContext,
  type V1Pod
} from '@kubernetes/client-node'

import type { PortForwardEvent, PortForwardOptions, ResourceRef } from '../../shared/ipc-types'
import { kcForCluster, loadK8s } from './k8s'

type Connection = Awaited<ReturnType<PortForward['portForward']>>
type Session = {
  sender: WebContents
  active: boolean
  controller: AbortController
  onDestroyed: () => void
  server?: Server
  sockets: Set<Socket>
  connections: Map<Socket, Connection>
}
const sessions = new Map<string, Session>()

function requestOptions(signal: AbortSignal): ConfigurationOptions {
  return {
    middlewareMergeStrategy: 'append',
    middleware: [
      {
        pre: (context: RequestContext) => {
          context.setSignal(signal)
          return new Observable(Promise.resolve(context))
        },
        post: (context: ResponseContext) => new Observable(Promise.resolve(context))
      }
    ]
  }
}

const selectorString = (labels?: Record<string, string>): string =>
  Object.entries(labels ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(',')

const isReady = (p: V1Pod): boolean =>
  p.status?.phase === 'Running' &&
  (p.status?.conditions ?? []).some((c) => c.type === 'Ready' && c.status === 'True')

const pickPod = (pods: V1Pod[]): V1Pod | undefined => pods.find(isReady) ?? pods[0]

/** Pods backing a workload, via its label selector (like services/logs.ts). */
async function workloadPods(
  kc: KubeConfig,
  ref: ResourceRef,
  ns: string,
  signal: AbortSignal
): Promise<V1Pod[]> {
  const k8s = await loadK8s()
  const core = kc.makeApiClient(k8s.CoreV1Api)
  const bySelector = async (labels?: Record<string, string>): Promise<V1Pod[]> => {
    const labelSelector = selectorString(labels)
    if (!labelSelector) return []
    signal.throwIfAborted()
    return (await core.listNamespacedPod({ namespace: ns, labelSelector }, requestOptions(signal)))
      .items
  }
  switch (ref.kind) {
    case 'deployments': {
      const d = await kc
        .makeApiClient(k8s.AppsV1Api)
        .readNamespacedDeployment({ name: ref.name, namespace: ns }, requestOptions(signal))
      return bySelector(d.spec?.selector?.matchLabels)
    }
    case 'statefulsets': {
      const s = await kc
        .makeApiClient(k8s.AppsV1Api)
        .readNamespacedStatefulSet({ name: ref.name, namespace: ns }, requestOptions(signal))
      return bySelector(s.spec?.selector?.matchLabels)
    }
    case 'daemonsets': {
      const d = await kc
        .makeApiClient(k8s.AppsV1Api)
        .readNamespacedDaemonSet({ name: ref.name, namespace: ns }, requestOptions(signal))
      return bySelector(d.spec?.selector?.matchLabels)
    }
    case 'jobs': {
      const j = await kc
        .makeApiClient(k8s.BatchV1Api)
        .readNamespacedJob({ name: ref.name, namespace: ns }, requestOptions(signal))
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
  remotePort: number,
  signal: AbortSignal
): Promise<{ ns: string; pod: string; podPort: number }> {
  const k8s = await loadK8s()
  const ns = ref.namespace ?? 'default'

  if (ref.kind === 'pods') return { ns, pod: ref.name, podPort: remotePort }

  if (ref.kind === 'services') {
    const core = kc.makeApiClient(k8s.CoreV1Api)
    const svc = await core.readNamespacedService(
      { name: ref.name, namespace: ns },
      requestOptions(signal)
    )
    const labelSelector = selectorString(svc.spec?.selector)
    if (!labelSelector) throw new Error('Service has no selector to resolve pods')
    signal.throwIfAborted()
    const pod = pickPod(
      (await core.listNamespacedPod({ namespace: ns, labelSelector }, requestOptions(signal))).items
    )
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

  const pod = pickPod(await workloadPods(kc, ref, ns, signal))
  if (!pod) throw new Error('No pods found for this resource')
  return { ns, pod: pod.metadata?.name ?? '', podPort: remotePort }
}

function current(id: string, session: Session): boolean {
  return session.active && sessions.get(id) === session && !session.sender.isDestroyed()
}

function send(id: string, session: Session, event: PortForwardEvent): void {
  if (current(id, session)) session.sender.send(`cluster:pf:${id}`, event)
}

function terminate(connection: Connection): void {
  try {
    const socket = typeof connection === 'function' ? connection() : connection
    socket?.terminate()
  } catch {
    // A disconnected WebSocket is already released.
  }
}

function dispose(id: string, session: Session): void {
  if (!session.active) return
  session.active = false
  if (sessions.get(id) === session) sessions.delete(id)
  session.controller.abort()
  session.sender.removeListener('destroyed', session.onDestroyed)
  for (const socket of session.sockets) socket.destroy()
  session.sockets.clear()
  for (const connection of session.connections.values()) terminate(connection)
  session.connections.clear()
  if (session.server) {
    try {
      session.server.close()
    } catch {
      // It may not have entered the listening state yet.
    }
  }
}

/** Acknowledge ownership immediately; target resolution and binding run in the
 * background and cannot publish a running event after teardown. */
export function startPortForward(
  sender: WebContents,
  id: string,
  clusterId: string,
  ref: ResourceRef,
  opts: PortForwardOptions
): void {
  const previous = sessions.get(id)
  if (previous) {
    if (previous.sender.id !== sender.id) throw new Error('Port forward belongs to another window')
    dispose(id, previous)
  }
  const session: Session = {
    sender,
    active: true,
    controller: new AbortController(),
    onDestroyed: () => dispose(id, session),
    sockets: new Set(),
    connections: new Map()
  }
  sessions.set(id, session)
  sender.once('destroyed', session.onDestroyed)
  if (sender.isDestroyed()) {
    dispose(id, session)
    return
  }

  void (async () => {
    try {
      const kc = await kcForCluster(clusterId)
      if (!current(id, session)) return
      const { PortForward } = await loadK8s()
      if (!current(id, session)) return
      const { ns, pod, podPort } = await resolveTarget(
        kc,
        ref,
        opts.remotePort,
        session.controller.signal
      )
      if (!current(id, session)) return
      const pf = new PortForward(kc)
      const server = createServer((socket) => {
        if (!current(id, session)) {
          socket.destroy()
          return
        }
        session.sockets.add(socket)
        socket.on('close', () => {
          session.sockets.delete(socket)
          const connection = session.connections.get(socket)
          if (connection) terminate(connection)
          session.connections.delete(socket)
        })
        socket.on('error', () => {})
        void pf.portForward(ns, pod, [podPort], socket, null, socket).then(
          (connection) => {
            if (!current(id, session) || socket.destroyed) terminate(connection)
            else session.connections.set(socket, connection)
          },
          () => socket.destroy()
        )
      })
      session.server = server
      server.on('error', (error) => {
        if (!current(id, session)) return
        send(id, session, {
          type: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
        dispose(id, session)
      })
      server.on('close', () => {
        if (!current(id, session)) return
        send(id, session, { type: 'closed' })
        dispose(id, session)
      })
      if (!current(id, session)) {
        dispose(id, session)
        return
      }
      server.listen(opts.localPort || 0, '127.0.0.1', () => {
        if (!current(id, session)) {
          try {
            server.close()
          } catch {
            /* already closed */
          }
          return
        }
        const addr = server.address()
        send(id, session, {
          type: 'running',
          localPort: typeof addr === 'object' && addr ? addr.port : 0
        })
      })
    } catch (error) {
      if (current(id, session)) {
        send(id, session, {
          type: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
        dispose(id, session)
      }
    }
  })()
}

export function stopPortForward(sender: WebContents, id: string): void {
  const session = sessions.get(id)
  if (session?.sender.id === sender.id) dispose(id, session)
}
