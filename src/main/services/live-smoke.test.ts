import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppsV1Api, CoreV1Api, KubeConfig } from '@kubernetes/client-node'

// resources.ts → k8s.ts → cluster-store.ts imports `electron` at module load; stub it so
// the dynamic `import('./resources')` below loads in node. listViaTable never touches electron.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/lightship-live-test' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8')
  }
}))

// Read-only smoke test against a REAL cluster. Skipped unless LIGHTSHIP_LIVE is set,
// so the default `pnpm test` stays hermetic/offline. Run with:
//   LIGHTSHIP_LIVE=1 pnpm test
//
// It does NOT use kcForCluster() (that decrypts a kubeconfig from Electron
// userData via safeStorage). Instead it loads ~/.kube/config directly and calls
// the same @kubernetes/client-node read APIs the service layer uses, so a green
// run means the live getOverview / listNodes / listResource / listPods mappers
// will receive the fields they expect. No mutations are ever issued.
const LIVE = !!process.env.LIGHTSHIP_LIVE

describe.skipIf(!LIVE)('live cluster smoke (read-only, ~/.kube/config)', () => {
  let kc: KubeConfig
  let core: CoreV1Api
  let apps: AppsV1Api

  beforeAll(async () => {
    const k8s = await import('@kubernetes/client-node')
    kc = new k8s.KubeConfig()
    kc.loadFromDefault()
    core = kc.makeApiClient(k8s.CoreV1Api)
    apps = kc.makeApiClient(k8s.AppsV1Api)
  })

  it('lists nodes with names (mirrors listNodes / getOverview)', async () => {
    const res = await core.listNode()
    expect(res.items.length).toBeGreaterThan(0)
    expect(res.items[0].metadata?.name).toBeTruthy()
  })

  it('lists namespaces (mirrors getOverview)', async () => {
    const res = await core.listNamespace()
    expect(res.items.length).toBeGreaterThan(0)
  })

  it('lists pods across all namespaces with name+namespace (mirrors listPods)', async () => {
    const res = await core.listPodForAllNamespaces()
    expect(Array.isArray(res.items)).toBe(true)
    if (res.items.length) {
      expect(res.items[0].metadata?.name).toBeTruthy()
      expect(res.items[0].metadata?.namespace).toBeTruthy()
    }
  })

  it('lists deployments (mirrors listResource:deployments)', async () => {
    const res = await apps.listDeploymentForAllNamespaces()
    expect(Array.isArray(res.items)).toBe(true)
  })

  it('reads node metrics when metrics-server is present (mirrors nodeMetricsMap)', async () => {
    const k8s = await import('@kubernetes/client-node')
    try {
      const top = await new k8s.Metrics(kc).getNodeMetrics()
      expect(Array.isArray(top.items)).toBe(true)
    } catch {
      // No metrics-server: the service degrades to cpuPct/memPct null. Acceptable.
    }
  })

  it('lists secrets via the Table API without pulling .data (mirrors listResource:secrets)', async () => {
    const { listViaTable } = await import('./resources')
    const rows = await listViaTable(kc, '/api/v1/secrets')
    expect(Array.isArray(rows)).toBe(true)
    if (rows.length) {
      expect(rows[0].metadata.name).toBeTruthy()
      // The Table `Data` print column is the key count (a number) — no secret values.
      expect(rows[0].cells.data).toMatch(/^\d+$/)
    }
  })
})
