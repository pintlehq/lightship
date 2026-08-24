import type { WebContents } from 'electron'
import type {
  KubeConfig,
  KubernetesListObject,
  KubernetesObject,
  V1Node,
  V1Pod
} from '@kubernetes/client-node'

import type { NodeRow, WatchDelta, WatchEvent, WatchRow } from '../../shared/ipc-types'
import { ageOf, kcForCluster, loadK8s } from './k8s'
import { mapPod, RESOURCE_MAPPERS } from './resource-mappers'
import { WATCH_SPECS } from './resource-watch-specs'

// Batch deltas before crossing the IPC boundary so a churny cluster (or the
// informer's initial add burst) stays smooth — mirrors logs.ts.
const FLUSH_MS = 100
const FLUSH_MAX = 100
// Backoff before re-establishing an informer that errored out (it does not
// auto-restart on a hard error in @kubernetes/client-node 1.4.0).
const RESTART_MS = 2000

// We only ever call .stop() on the stored handle; keep the type minimal so we
// don't depend on the package's exact Informer export.
type Sub = { informer?: { stop(): Promise<void> }; cleanup: () => void; stopped: boolean }
const subs = new Map<string, Sub>()

/** How to watch one kind: the API path the informer watches, a listPromiseFn
 *  factory (its initial/relist source), and the object→row mapper. */
type Spec = {
  path: string
  list: (kc: KubeConfig) => () => Promise<KubernetesListObject<KubernetesObject>>
  map: (o: KubernetesObject) => WatchRow
}

/** Structural NodeRow from a Node object. cpu/mem/pods/pcts are left at 0/'' —
 *  they need metrics-server + cross-object pod counts, so the renderer ignores a
 *  node delta's payload and refetches the full nodes list instead. */
function mapNodeStructural(o: KubernetesObject): NodeRow {
  const n = o as V1Node
  const labels = n.metadata?.labels ?? {}
  const cp = Object.keys(labels).some(
    (k) =>
      k.startsWith('node-role.kubernetes.io/control-plane') ||
      k.startsWith('node-role.kubernetes.io/master')
  )
  const ready = (n.status?.conditions ?? []).some((c) => c.type === 'Ready' && c.status === 'True')
  return {
    name: n.metadata?.name ?? '',
    roles: cp ? ['control-plane'] : ['worker'],
    status: ready ? 'Ready' : 'NotReady',
    cpuPct: 0,
    cpu: '',
    memPct: 0,
    mem: '',
    pods: 0,
    maxPods: Number(n.status?.allocatable?.pods ?? 0),
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
}

/** Resolve the watch spec for a kind. `pods`/`nodes` are special-cased (bespoke
 *  shapes); every other kind reuses the resource list spec + mapper. */
export function specFor(kind: string): Spec | null {
  if (kind === 'pods') {
    return {
      path: '/api/v1/pods',
      list: (kc) => async () => {
        const { CoreV1Api } = await loadK8s()
        return (await kc
          .makeApiClient(CoreV1Api)
          .listPodForAllNamespaces()) as KubernetesListObject<KubernetesObject>
      },
      map: (o) => mapPod(o as V1Pod)
    }
  }
  if (kind === 'nodes') {
    return {
      path: '/api/v1/nodes',
      list: (kc) => async () => {
        const { CoreV1Api } = await loadK8s()
        return (await kc
          .makeApiClient(CoreV1Api)
          .listNode()) as KubernetesListObject<KubernetesObject>
      },
      map: mapNodeStructural
    }
  }
  const spec = WATCH_SPECS[kind]
  const map = RESOURCE_MAPPERS[kind]
  if (!spec || !map) return null
  return { path: spec.path, list: spec.list, map }
}

/** Start a live informer for (cluster, kind) and push reset/deltas/status events
 *  to the renderer on `cluster:watch:<subId>`. Idempotent per subId. */
export async function startWatch(
  sender: WebContents,
  subId: string,
  clusterId: string,
  kind: string
): Promise<void> {
  stopWatch(subId) // a re-subscribe with the same id replaces the old informer

  const send = (ev: WatchEvent): void => {
    if (!sender.isDestroyed()) sender.send(`cluster:watch:${subId}`, ev)
  }

  let buf: WatchDelta[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let backoffTimer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    flushTimer = null
    if (buf.length) {
      send({ type: 'deltas', items: buf })
      buf = []
    }
  }
  const push = (op: WatchDelta['op'], row: WatchRow): void => {
    buf.push({ op, row })
    if (buf.length >= FLUSH_MAX) flush()
    else if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS)
  }
  const cleanup = (): void => {
    if (flushTimer) clearTimeout(flushTimer)
    if (backoffTimer) clearTimeout(backoffTimer)
    flushTimer = null
    backoffTimer = null
  }

  const sub: Sub = { cleanup, stopped: false }
  subs.set(subId, sub)
  sender.once('destroyed', () => stopWatch(subId))

  const spec = specFor(kind)
  if (!spec) {
    send({ type: 'status', state: 'error', message: `Not watchable: ${kind}` })
    return
  }

  try {
    const kc = await kcForCluster(clusterId)
    if (subs.get(subId) !== sub) return
    const { makeInformer } = await loadK8s()

    // Emit a full snapshot every time the informer (re)lists. CONNECT fires
    // before the cache is populated, so the list wrapper is the only reliable
    // post-populate hook — and a relist is exactly when we must reconcile rows
    // deleted while disconnected.
    const listFn = (): Promise<KubernetesListObject<KubernetesObject>> =>
      spec
        .list(kc)()
        .then((list) => {
          send({ type: 'reset', rows: list.items.map(spec.map) })
          return list
        })

    const informer = makeInformer<KubernetesObject>(kc, spec.path, listFn)
    sub.informer = informer
    informer.on('add', (o) => push('added', spec.map(o)))
    informer.on('update', (o) => push('modified', spec.map(o)))
    informer.on('delete', (o) => push('deleted', spec.map(o)))
    informer.on('connect', () => send({ type: 'status', state: 'connected' }))
    informer.on('error', (err) => {
      send({
        type: 'status',
        state: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
      if (!sub.stopped && !backoffTimer) {
        backoffTimer = setTimeout(() => {
          backoffTimer = null
          if (!sub.stopped) void informer.start().catch(() => {})
        }, RESTART_MS)
      }
    })

    await informer.start()
    // Torn down while we were connecting → stop the informer we just started.
    if (subs.get(subId) !== sub) {
      void informer.stop().catch(() => {})
    }
  } catch (e) {
    send({ type: 'status', state: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

/** Stop and forget a watch subscription. */
export function stopWatch(subId: string): void {
  const sub = subs.get(subId)
  if (!sub) return
  subs.delete(subId)
  sub.stopped = true
  sub.cleanup()
  if (sub.informer) void sub.informer.stop().catch(() => {})
}
