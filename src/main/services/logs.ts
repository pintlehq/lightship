import { PassThrough, type Readable } from 'node:stream'
import type { WebContents } from 'electron'
import type { KubeConfig, V1Pod } from '@kubernetes/client-node'

import type { LogEvent, LogLine, LogStreamOptions, ResourceRef } from '../../shared/ipc-types'
import { kcForCluster, loadK8s } from './k8s'

// One pod-container to tail.
type Target = { ns: string; pod: string; container: string }

// Bound the fan-out: a busy Deployment can own hundreds of pods.
const MAX_PODS = 20
// Batch lines before crossing the IPC boundary so chatty logs stay smooth.
const FLUSH_MS = 120
const FLUSH_LINES = 200
const DEFAULT_TAIL = 200

type Sub = { controllers: AbortController[]; cleanup: () => void }
const subs = new Map<string, Sub>()

const selectorString = (labels?: Record<string, string>): string =>
  Object.entries(labels ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(',')

/** Every pod that a workload owns (via its label selector). */
async function candidatePods(kc: KubeConfig, ref: ResourceRef, ns: string): Promise<V1Pod[]> {
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
    case 'cronjobs': {
      // CronJob → its Jobs (by ownerRef) → each Job's pods.
      const batch = kc.makeApiClient(k8s.BatchV1Api)
      const cj = await batch.readNamespacedCronJob({ name: ref.name, namespace: ns })
      const cjUid = cj.metadata?.uid
      const jobs = (await batch.listNamespacedJob({ namespace: ns })).items.filter((j) =>
        j.metadata?.ownerReferences?.some((o) => o.uid === cjUid)
      )
      const byUid = new Map<string, V1Pod>()
      for (const j of jobs) {
        for (const p of await bySelector(j.spec?.selector?.matchLabels)) {
          byUid.set(p.metadata?.uid ?? `${p.metadata?.namespace}/${p.metadata?.name}`, p)
        }
      }
      return [...byUid.values()]
    }
    default:
      return []
  }
}

async function resolveTargets(
  kc: KubeConfig,
  ref: ResourceRef,
  opts: LogStreamOptions
): Promise<{ targets: Target[]; podCount: number }> {
  const k8s = await loadK8s()
  const ns = ref.namespace ?? 'default'
  const pods =
    ref.kind === 'pods'
      ? [await kc.makeApiClient(k8s.CoreV1Api).readNamespacedPod({ name: ref.name, namespace: ns })]
      : await candidatePods(kc, ref, ns)

  const targets: Target[] = []
  for (const p of pods.slice(0, MAX_PODS)) {
    const pod = p.metadata?.name ?? ''
    const podNs = p.metadata?.namespace ?? ns
    for (const c of p.spec?.containers ?? []) {
      if (opts.container && c.name !== opts.container) continue
      targets.push({ ns: podNs, pod, container: c.name })
    }
  }
  return { targets, podCount: pods.length }
}

/** Open a follow-stream for a pod (or every pod a workload owns) and push batched
 *  log lines to the renderer on `cluster:logs:<subId>`. Idempotent per subId. */
export async function startLogStream(
  sender: WebContents,
  subId: string,
  clusterId: string,
  ref: ResourceRef,
  opts: LogStreamOptions
): Promise<void> {
  stopLogStream(subId) // a re-subscribe with the same id replaces the old streams

  const controllers: AbortController[] = []
  let buf: LogLine[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let active = true

  const send = (ev: LogEvent): void => {
    if (active && !sender.isDestroyed()) sender.send(`cluster:logs:${subId}`, ev)
  }
  const flush = (): void => {
    timer = null
    if (buf.length) {
      send({ type: 'lines', items: buf })
      buf = []
    }
  }
  const push = (line: LogLine): void => {
    if (!active) return
    buf.push(line)
    if (buf.length >= FLUSH_LINES) flush()
    else if (!timer) timer = setTimeout(flush, FLUSH_MS)
  }
  const onDestroyed = (): void => stopLogStream(subId)
  const cleanup = (): void => {
    if (!active) return
    active = false
    if (timer) clearTimeout(timer)
    timer = null
    buf = []
    sender.removeListener('destroyed', onDestroyed)
  }

  const sub: Sub = { controllers, cleanup }
  subs.set(subId, sub)
  sender.once('destroyed', onDestroyed)

  try {
    const kc = await kcForCluster(clusterId)
    const { Log } = await loadK8s()
    const { targets, podCount } = await resolveTargets(kc, ref, opts)

    // Abort if the subscription was torn down while we were resolving.
    if (subs.get(subId) !== sub) return

    if (podCount > MAX_PODS) {
      push({ pod: '', container: '', ts: '', msg: `… showing ${MAX_PODS} of ${podCount} pods` })
    }
    if (targets.length === 0) {
      send({
        type: 'lines',
        items: [{ pod: '', container: '', ts: '', msg: 'No pods found for this resource.' }]
      })
      send({ type: 'end' })
      return
    }

    const log = new Log(kc)
    for (const t of targets) {
      if (!active) return
      const pt = new PassThrough()
      let carry = ''
      pt.on('data', (chunk: Buffer) => {
        carry += chunk.toString('utf8')
        const parts = carry.split('\n')
        carry = parts.pop() ?? ''
        for (const raw of parts) {
          if (!raw) continue
          const sp = raw.indexOf(' ')
          const ts = sp > 0 ? raw.slice(0, sp) : ''
          const msg = sp > 0 ? raw.slice(sp + 1) : raw
          push({ pod: t.pod, container: t.container, ts, msg })
        }
      })
      pt.on('error', () => {})
      // @kubernetes/client-node pipes a hidden Readable.fromWeb(response.body)
      // into the supplied writable. Aborting its controller errors that readable,
      // not this PassThrough, so observe the source via the standard `pipe` event.
      // Expected teardown errors are ignored; live transport failures stay scoped
      // to the affected pod/container instead of becoming process-level errors.
      pt.once('pipe', (source: Readable) => {
        source.on('error', (e: unknown) => {
          if (!active) return
          push({
            pod: t.pod,
            container: t.container,
            ts: '',
            msg: `failed to stream: ${e instanceof Error ? e.message : String(e)}`
          })
        })
      })

      try {
        const ctrl = await log.log(t.ns, t.pod, t.container, pt, {
          follow: true,
          timestamps: true,
          tailLines: opts.tailLines ?? DEFAULT_TAIL
        })
        // Torn down mid-loop → abort the just-opened stream and bail.
        if (subs.get(subId) !== sub) {
          ctrl.abort()
          return
        }
        controllers.push(ctrl)
      } catch (e) {
        if (!active) return
        push({
          pod: t.pod,
          container: t.container,
          ts: '',
          msg: `failed to stream: ${e instanceof Error ? e.message : String(e)}`
        })
      }
    }
  } catch (e) {
    send({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

/** Abort every stream for a subscription and forget it. */
export function stopLogStream(subId: string): void {
  const sub = subs.get(subId)
  if (!sub) return
  subs.delete(subId)
  sub.cleanup()
  for (const c of sub.controllers) {
    try {
      c.abort()
    } catch {
      /* already settled */
    }
  }
}
