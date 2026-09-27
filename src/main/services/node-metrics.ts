import type { KubeConfig } from '@kubernetes/client-node'
import { loadK8s } from './k8s-client'
import { cpuToCores, memoryToBytes } from './quantities'

export async function nodeMetricsMap(
  kc: KubeConfig
): Promise<Record<string, { cpu: number; mem: number }>> {
  try {
    const { Metrics } = await loadK8s()
    const top = await new Metrics(kc).getNodeMetrics()
    const out: Record<string, { cpu: number; mem: number }> = {}
    for (const it of top.items) {
      out[it.metadata?.name ?? ''] = {
        cpu: cpuToCores(it.usage?.cpu),
        mem: memoryToBytes(it.usage?.memory)
      }
    }
    return out
  } catch {
    return {} // metrics-server not installed
  }
}
