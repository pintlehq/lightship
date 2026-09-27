import type { KubeConfig } from '@kubernetes/client-node'

import type {
  ClusterAddSelection,
  ClusterMeta,
  DetectedContext,
  TestResult
} from '../../shared/ipc-types'
import { listClusters, saveCluster } from './cluster-store'

import { kcForCluster, loadK8s } from './k8s-client'

function mapContexts(kc: KubeConfig): DetectedContext[] {
  return kc.getContexts().map((ctx) => ({
    name: ctx.name,
    cluster: ctx.cluster,
    user: ctx.user,
    server: kc.getCluster(ctx.cluster)?.server ?? ''
  }))
}

async function withAddedFlags(contexts: DetectedContext[]): Promise<DetectedContext[]> {
  const existing = new Set((await listClusters()).map((c) => c.context))
  return contexts.map((c) => ({ ...c, alreadyAdded: existing.has(c.name) }))
}

export async function detectKubeconfigContexts(): Promise<DetectedContext[]> {
  const { KubeConfig } = await loadK8s()
  const kc = new KubeConfig()
  try {
    kc.loadFromDefault()
  } catch {
    return []
  }
  return withAddedFlags(mapContexts(kc))
}

export async function parseKubeconfig(yaml: string): Promise<DetectedContext[]> {
  const { KubeConfig } = await loadK8s()
  const kc = new KubeConfig()
  kc.loadFromString(yaml)
  return withAddedFlags(mapContexts(kc))
}

export async function addClusters(selections: ClusterAddSelection[]): Promise<ClusterMeta[]> {
  const { KubeConfig } = await loadK8s()
  const added: ClusterMeta[] = []
  for (const sel of selections) {
    const src = new KubeConfig()
    if (sel.kubeconfig) src.loadFromString(sel.kubeconfig)
    else src.loadFromDefault()
    const ctx = src.getContextObject(sel.context)
    if (!ctx) continue
    const cluster = src.getCluster(ctx.cluster)
    const user = src.getUser(ctx.user)
    // Export a minimal kubeconfig with only this context's cluster/user.
    const mini = new KubeConfig()
    mini.loadFromOptions({
      clusters: cluster ? [cluster] : [],
      users: user ? [user] : [],
      contexts: [ctx],
      currentContext: ctx.name
    })
    const meta = await saveCluster(
      { name: ctx.name, context: ctx.name, server: cluster?.server ?? '' },
      mini.exportConfig()
    )
    added.push(meta)
  }
  return added
}

export async function testConnection(clusterId: string): Promise<TestResult> {
  try {
    const kc = await kcForCluster(clusterId)
    const { VersionApi } = await loadK8s()
    const info = await kc.makeApiClient(VersionApi).getCode()
    return { ok: true, version: info.gitVersion ?? `${info.major}.${info.minor}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
