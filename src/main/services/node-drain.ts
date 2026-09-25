import type { WebContents } from 'electron'
import {
  Observable,
  type ConfigurationOptions,
  type CoreV1Api,
  type RequestContext,
  type ResponseContext,
  type V1Pod
} from '@kubernetes/client-node'

import {
  DrainEventSchema,
  type DrainPod,
  type DrainProgress,
  type DrainResult
} from '../../shared/ipc-types'
import { recordActivity } from './activity'
import { kcForCluster, loadK8s } from './k8s'
import { cordonNode, isEvictable } from './resource-mutations'

const NODE_DEADLINE_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 15_000
const POLL_MS = 2_000
const sessions = new Map<
  string,
  { sender: WebContents; controller: AbortController; key: string }
>()
const activeNodes = new Set<string>()

class DrainInterrupted extends Error {
  constructor(readonly status: 'timed-out' | 'cancelled') {
    super(
      status === 'cancelled'
        ? 'Drain cancelled; node remains cordoned'
        : 'Drain timed out; node remains cordoned'
    )
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const httpStatus = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined
  const value = error as {
    code?: unknown
    statusCode?: unknown
    response?: { statusCode?: unknown }
  }
  const code = value.statusCode ?? value.response?.statusCode ?? value.code
  return typeof code === 'number' ? code : undefined
}

const podId = (pod: V1Pod): string =>
  `${pod.metadata?.namespace ?? '?'}/${pod.metadata?.name ?? '?'}`
const podKey = (pod: V1Pod): string =>
  `${pod.metadata?.namespace ?? '?'}\u0000${pod.metadata?.name ?? '?'}\u0000${pod.metadata?.uid ?? ''}`

function classify(pod: V1Pod): DrainPod | undefined {
  const namespace = pod.metadata?.namespace ?? '?'
  const name = pod.metadata?.name ?? '?'
  if (!isEvictable(pod)) {
    const reason = pod.metadata?.ownerReferences?.some((owner) => owner.kind === 'DaemonSet')
      ? 'DaemonSet pod'
      : pod.metadata?.annotations?.['kubernetes.io/config.mirror']
        ? 'Mirror pod'
        : 'Completed pod'
    return { namespace, name, status: 'skipped', reason }
  }
  if (!pod.metadata?.namespace || !pod.metadata.name) {
    return { namespace, name, status: 'blocked', reason: 'Pod identity is missing' }
  }
  if (!(pod.metadata.ownerReferences ?? []).some((owner) => owner.controller === true)) {
    return { namespace, name, status: 'blocked', reason: 'Unmanaged pod' }
  }
  if (pod.spec?.volumes?.some((volume) => volume.emptyDir !== undefined)) {
    return { namespace, name, status: 'blocked', reason: 'Pod uses local emptyDir storage' }
  }
  return undefined
}

function checkInterrupted(signal: AbortSignal, deadline: number): void {
  if (signal.aborted) throw new DrainInterrupted('cancelled')
  if (Date.now() >= deadline) throw new DrainInterrupted('timed-out')
}

/** Abort both the generated client request and our wait, including with test doubles. */
async function request<T>(
  run: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  deadline: number
): Promise<T> {
  checkInterrupted(signal, deadline)
  const controller = new AbortController()
  const waitMs = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now())
  let timer: ReturnType<typeof setTimeout> | undefined
  const abort = (): void => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  try {
    const interrupted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => reject(new DrainInterrupted(signal.aborted ? 'cancelled' : 'timed-out')),
        { once: true }
      )
    })
    timer = setTimeout(abort, waitMs)
    return await Promise.race([run(controller.signal), interrupted])
  } finally {
    if (timer) clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

function options(signal: AbortSignal): ConfigurationOptions {
  return {
    middlewareMergeStrategy: 'append' as const,
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

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DrainInterrupted('cancelled'))
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    const abort = (): void => {
      clearTimeout(timer)
      reject(new DrainInterrupted('cancelled'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })

/** Runs one node drain; a success requires a fresh list with no eligible pods. */
export async function drainNode(
  clusterId: string,
  node: string,
  signal: AbortSignal,
  onProgress: (progress: DrainProgress) => void
): Promise<DrainResult> {
  const deadline = Date.now() + NODE_DEADLINE_MS
  const outcomes = new Map<string, DrainPod>()
  let observed: V1Pod[] = []
  let cordoned = false
  const emit = (phase: DrainProgress['phase'], message: string): void =>
    onProgress({ node, phase, message, pods: [...outcomes.values()] })
  const result = (status: DrainResult['status'], reason?: string): DrainResult => ({
    clusterId,
    node,
    status,
    reason,
    pods: [...outcomes.values()],
    remaining: observed.filter(isEvictable).map((pod) => {
      const existing = outcomes.get(podKey(pod))
      return {
        namespace: pod.metadata?.namespace ?? '?',
        name: pod.metadata?.name ?? '?',
        status: 'remaining',
        reason: existing?.reason ?? 'Last observed on node'
      }
    })
  })

  try {
    emit('cordoning', `Cordoning ${node}`)
    checkInterrupted(signal, deadline)
    // The object patch API has no per-request signal. Bound the wait and report
    // an unknown cordon state if it times out or is cancelled before it settles.
    await request(() => cordonNode(clusterId, node), signal, deadline)
    cordoned = true
    checkInterrupted(signal, deadline)
    const { CoreV1Api } = await request(() => loadK8s(), signal, deadline)
    const core: CoreV1Api = (
      await request(() => kcForCluster(clusterId), signal, deadline)
    ).makeApiClient(CoreV1Api)
    const accepted = new Set<string>()
    let retryMs = 2_000

    while (true) {
      emit('listing', 'Checking pods still scheduled on the node')
      const list = await request(
        (requestSignal) =>
          core.listPodForAllNamespaces(
            { fieldSelector: `spec.nodeName=${node}` },
            options(requestSignal)
          ),
        signal,
        deadline
      )
      const next = list.items
      const nextKeys = new Set(next.map(podKey))
      for (const [key, outcome] of outcomes) {
        if (outcome.status === 'eviction-accepted' && !nextKeys.has(key)) {
          outcomes.set(key, { ...outcome, status: 'removed', reason: undefined })
        }
      }
      observed = next
      const eligible = next.filter(isEvictable)
      for (const pod of next) {
        const classification = classify(pod)
        if (classification) outcomes.set(podKey(pod), classification)
      }
      const blockers = eligible.filter((pod) => classify(pod)?.status === 'blocked')
      if (blockers.length) {
        const details = blockers
          .map((pod) => `${podId(pod)} (${classify(pod)?.reason ?? 'unsafe to evict'})`)
          .join(', ')
        return result('failed', `Drain blocked by ${details}; node remains cordoned`)
      }
      if (eligible.length === 0) {
        emit('waiting', 'No eligible pods remain on the node')
        return result('completed')
      }

      let retry = false
      for (const pod of eligible) {
        const key = podKey(pod)
        if (accepted.has(key)) continue
        checkInterrupted(signal, deadline)
        const namespace = pod.metadata!.namespace!
        const name = pod.metadata!.name!
        emit('evicting', `Requesting eviction for ${namespace}/${name}`)
        try {
          await request(
            (requestSignal) =>
              core.createNamespacedPodEviction(
                {
                  namespace,
                  name,
                  body: {
                    apiVersion: 'policy/v1',
                    kind: 'Eviction',
                    metadata: { namespace, name }
                  }
                },
                options(requestSignal)
              ),
            signal,
            deadline
          )
          accepted.add(key)
          outcomes.set(key, { namespace, name, status: 'eviction-accepted' })
          emit('waiting', `Eviction accepted for ${namespace}/${name}; waiting for removal`)
        } catch (error) {
          if (error instanceof DrainInterrupted) throw error
          const code = httpStatus(error)
          if (code === 404) {
            retry = true // It may have disappeared; only a fresh list can confirm.
            break
          }
          if (code === 429) {
            outcomes.set(key, {
              namespace,
              name,
              status: 'remaining',
              reason: 'Eviction rejected by disruption budget or rate limit (HTTP 429)'
            })
            emit('waiting', `Eviction delayed for ${namespace}/${name} (HTTP 429)`)
            retry = true
            break
          }
          outcomes.set(key, { namespace, name, status: 'failed', reason: messageOf(error) })
          return result('failed', `Eviction failed for ${namespace}/${name}: ${messageOf(error)}`)
        }
      }
      emit('waiting', 'Waiting for eligible pods to leave the node')
      const delay = retry ? retryMs : POLL_MS
      if (retry) retryMs = Math.min(retryMs * 2, 10_000)
      else retryMs = 2_000
      checkInterrupted(signal, deadline)
      await wait(Math.min(delay, deadline - Date.now()), signal)
    }
  } catch (error) {
    const status = error instanceof DrainInterrupted ? error.status : 'failed'
    const reason =
      error instanceof DrainInterrupted && !cordoned
        ? `Drain ${error.status} before cordon was confirmed; node schedulability is unknown`
        : error instanceof DrainInterrupted
          ? error.message
          : `${messageOf(error)}; ${cordoned ? 'node remains cordoned' : 'cordon state may be unknown'}`
    return result(status, reason)
  }
}

/** Synchronously register ownership before the first async drain step. */
export async function startDrain(
  sender: WebContents,
  subId: string,
  clusterId: string,
  node: string
): Promise<DrainResult> {
  const key = `${clusterId}\u0000${node}`
  if (sessions.has(subId)) throw new Error('Drain operation ID is already in use')
  if (activeNodes.has(key)) throw new Error(`A drain is already active for ${node}`)
  const controller = new AbortController()
  sessions.set(subId, { sender, controller, key })
  activeNodes.add(key)
  const onDestroyed = (): void => controller.abort()
  sender.once('destroyed', onDestroyed)
  try {
    if (sender.isDestroyed()) controller.abort()
    else sender.send(`cluster:drain:${subId}`, DrainEventSchema.parse({ type: 'started' }))
    const outcome = await drainNode(clusterId, node, controller.signal, (progress) => {
      if (!sender.isDestroyed()) {
        sender.send(
          `cluster:drain:${subId}`,
          DrainEventSchema.parse({ type: 'progress', progress })
        )
      }
    })
    try {
      outcome.activityRecord = await recordActivity({
        clusterId,
        action: 'drain',
        kind: 'nodes',
        name: node,
        count: 1,
        outcome: outcome.status === 'completed' ? 'success' : 'error',
        message: outcome.reason ?? 'All eligible pods left the node'
      })
    } catch (error) {
      outcome.activityError = `Could not save drain history: ${messageOf(error)}`
    }
    return outcome
  } finally {
    sender.removeListener('destroyed', onDestroyed)
    sessions.delete(subId)
    activeNodes.delete(key)
  }
}

export function cancelDrain(sender: WebContents, subId: string): void {
  const session = sessions.get(subId)
  if (session && session.sender.id === sender.id) session.controller.abort()
}
