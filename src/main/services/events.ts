import type { ClusterEvent, ResourceRef } from '../../shared/ipc-types'
import { kcForCluster, loadK8s } from './k8s-client'
import { ageOf } from './quantities'

/** Recent cluster events, newest first (capped). With `ref`, only that object's
 *  events (filtered server-side); otherwise cluster-wide across all namespaces. */
export async function listEvents(clusterId: string, ref?: ResourceRef): Promise<ClusterEvent[]> {
  const kc = await kcForCluster(clusterId)
  const { CoreV1Api } = await loadK8s()
  const core = kc.makeApiClient(CoreV1Api)
  const res =
    ref?.kind === 'namespaces'
      ? await core.listNamespacedEvent({ namespace: ref.name })
      : ref
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
