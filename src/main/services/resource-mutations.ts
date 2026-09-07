import type { KubernetesObject, V1Pod } from '@kubernetes/client-node'

import { canRestartResource, canScaleResource } from '../../shared/resource-capabilities'
import type { ResourceRef } from '../../shared/ipc-types'
import { kcForCluster, loadK8s } from './k8s'
import { GVK, resolveGvk } from './resource-gvk'
import { isNamespaceProtected } from './namespaces'

export async function objectApi(clusterId: string) {
  const { KubernetesObjectApi } = await loadK8s()
  return KubernetesObjectApi.makeApiClient(await kcForCluster(clusterId))
}

export async function deleteResource(clusterId: string, ref: ResourceRef): Promise<void> {
  if (ref.kind === 'namespaces' && isNamespaceProtected(ref.name)) {
    throw new Error(`Namespace ${ref.name} is protected and cannot be deleted`)
  }
  const gvk = GVK[ref.kind]
  if (!gvk) throw new Error(`Unknown resource kind: ${ref.kind}`)
  const obj = await objectApi(clusterId)
  await obj.delete({
    apiVersion: gvk.apiVersion,
    kind: gvk.kind,
    metadata: { name: ref.name, namespace: gvk.namespaced ? ref.namespace : undefined }
  })
}

export async function rolloutRestart(clusterId: string, ref: ResourceRef): Promise<void> {
  const gvk = GVK[ref.kind]
  if (!gvk || !canRestartResource(ref.kind)) throw new Error(`Not restartable: ${ref.kind}`)
  const obj = await objectApi(clusterId)
  await obj.patch({
    apiVersion: gvk.apiVersion,
    kind: gvk.kind,
    metadata: { name: ref.name, namespace: ref.namespace },
    spec: {
      template: {
        metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } }
      }
    }
  })
}

export async function scaleResource(
  clusterId: string,
  ref: ResourceRef,
  replicas: number
): Promise<void> {
  const gvk = GVK[ref.kind]
  if (!gvk || !canScaleResource(ref.kind)) throw new Error(`Not scalable: ${ref.kind}`)
  if (!Number.isInteger(replicas) || replicas < 0)
    throw new Error('Replica count must be a non-negative integer')
  const obj = await objectApi(clusterId)
  await obj.patch({
    apiVersion: gvk.apiVersion,
    kind: gvk.kind,
    metadata: { name: ref.name, namespace: ref.namespace },
    spec: { replicas }
  })
}

/** Patch a node's `spec.unschedulable` via strategic merge. */
async function setUnschedulable(
  clusterId: string,
  name: string,
  unschedulable: boolean
): Promise<void> {
  const obj = await objectApi(clusterId)
  await obj.patch({ apiVersion: 'v1', kind: 'Node', metadata: { name }, spec: { unschedulable } })
}

export const cordonNode = (clusterId: string, name: string): Promise<void> =>
  setUnschedulable(clusterId, name, true)

export const uncordonNode = (clusterId: string, name: string): Promise<void> =>
  setUnschedulable(clusterId, name, false)

/** A pod is drain-evictable unless it is DaemonSet-owned, a static/mirror pod, or
 * already completed (Succeeded/Failed). */
export function isEvictable(p: V1Pod): boolean {
  if (p.metadata?.ownerReferences?.some((r) => r.kind === 'DaemonSet')) return false
  if (p.metadata?.annotations?.['kubernetes.io/config.mirror']) return false
  const phase = p.status?.phase
  if (phase === 'Succeeded' || phase === 'Failed') return false
  return true
}

/** Cordon a node, then best-effort evict its eligible pods. Per-pod failures
 * are logged and skipped - no wait/poll loop. */
export async function drainNode(clusterId: string, name: string): Promise<void> {
  await setUnschedulable(clusterId, name, true)
  const { CoreV1Api } = await loadK8s()
  const kc = await kcForCluster(clusterId)
  const core = kc.makeApiClient(CoreV1Api)
  const pods = await core.listPodForAllNamespaces({ fieldSelector: `spec.nodeName=${name}` })
  for (const p of pods.items) {
    if (!isEvictable(p)) continue
    const podName = p.metadata?.name
    const ns = p.metadata?.namespace
    if (!podName || !ns) continue
    try {
      await core.createNamespacedPodEviction({
        name: podName,
        namespace: ns,
        body: {
          apiVersion: 'policy/v1',
          kind: 'Eviction',
          metadata: { name: podName, namespace: ns }
        }
      })
    } catch (e) {
      console.error(
        `drain ${name}: failed to evict ${ns}/${podName}:`,
        e instanceof Error ? e.message : e
      )
    }
  }
}

/** Read a single resource's live manifest and serialize it to YAML. */
export async function getYaml(clusterId: string, ref: ResourceRef): Promise<string> {
  const gvk = resolveGvk(ref)
  if (!gvk) throw new Error(`Unknown resource kind: ${ref.kind}`)
  const { dumpYaml } = await loadK8s()
  const obj = await objectApi(clusterId)
  const live = await obj.read({
    apiVersion: gvk.apiVersion,
    kind: gvk.kind,
    metadata: { name: ref.name, namespace: gvk.namespaced ? ref.namespace : undefined }
  })
  // Drop server-managed noise so the editor shows a clean manifest.
  if (live.metadata) delete (live.metadata as Record<string, unknown>).managedFields
  return dumpYaml(live)
}

/** Apply an edited manifest back to the cluster. */
export async function applyYaml(clusterId: string, _ref: ResourceRef, yaml: string): Promise<void> {
  const { loadYaml } = await loadK8s()
  const parsed = loadYaml<KubernetesObject>(yaml)
  const obj = await objectApi(clusterId)
  await obj.replace(parsed)
}

/** Create a new resource from a manifest. */
export async function createYaml(clusterId: string, yaml: string): Promise<void> {
  const { loadYaml } = await loadK8s()
  const parsed = loadYaml<KubernetesObject>(yaml)
  const obj = await objectApi(clusterId)
  await obj.create(parsed)
}
