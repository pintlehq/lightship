import type { KubeConfig } from '@kubernetes/client-node'
import { readKubeconfig } from './cluster-store'

// @kubernetes/client-node is ESM-only; the main process is CJS, so load it via
// a memoised dynamic import inside async code.
type K8sModule = typeof import('@kubernetes/client-node')
let modPromise: Promise<K8sModule> | undefined
export const loadK8s = (): Promise<K8sModule> => (modPromise ??= import('@kubernetes/client-node'))

const kcCache = new Map<string, KubeConfig>()

export function invalidate(clusterId?: string): void {
  if (clusterId) kcCache.delete(clusterId)
  else kcCache.clear()
}

/** KubeConfig for a stored cluster (cached). Exported for later phases. */
export async function kcForCluster(clusterId: string): Promise<KubeConfig> {
  const cached = kcCache.get(clusterId)
  if (cached) return cached
  const { KubeConfig } = await loadK8s()
  const kc = new KubeConfig()
  kc.loadFromString(await readKubeconfig(clusterId))
  kcCache.set(clusterId, kc)
  return kc
}
