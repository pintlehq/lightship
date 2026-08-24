import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the k8s module so importing resources.ts neither loads the real
// @kubernetes/client-node nor pulls in electron (via cluster-store). The fake
// KubernetesObjectApi records delete/patch payloads so we can assert the
// GVK-mapping contract WITHOUT any cluster I/O (M0 read-only constraint).
const rec = vi.hoisted(() => ({
  del: [] as Array<Record<string, unknown>>,
  patch: [] as Array<Record<string, unknown>>,
  create: [] as Array<Record<string, unknown>>
}))

vi.mock('./k8s', () => ({
  ageOf: () => '',
  kcForCluster: async () => ({}),
  loadK8s: async () => ({
    // Stand-in for js-yaml's loadYaml — tag the input so the test can assert the
    // parsed manifest is what reaches create().
    loadYaml: (y: string) => ({ __yaml: y }),
    KubernetesObjectApi: {
      makeApiClient: () => ({
        delete: async (obj: Record<string, unknown>) => {
          rec.del.push(obj)
        },
        patch: async (obj: Record<string, unknown>) => {
          rec.patch.push(obj)
        },
        create: async (obj: Record<string, unknown>) => {
          rec.create.push(obj)
        }
      })
    }
  })
}))

import {
  cordonNode,
  createYaml,
  deleteResource,
  isEvictable,
  isListableResource,
  mapPod,
  parseCpu,
  parseMem,
  podKey,
  RESOURCE_MAPPERS,
  rolloutRestart,
  scaleResource,
  uncordonNode,
  WATCH_SPECS
} from './resources'

type PodArg = Parameters<typeof mapPod>[0]
type RowArg = Parameters<(typeof RESOURCE_MAPPERS)[string]>[0]

describe('isListableResource', () => {
  it('is true for the registry-backed kinds (incl. RBAC + CRD)', () => {
    for (const kind of [
      'deployments',
      'services',
      'pvc',
      'pv',
      'roles',
      'rolebindings',
      'clusterroles',
      'clusterrolebindings',
      'serviceaccounts',
      'crd'
    ]) {
      expect(isListableResource(kind)).toBe(true)
    }
  })
  it('is false for pods (listPods), helm (bespoke), the rbac group id, and non-list kinds', () => {
    for (const kind of ['pods', 'helm', 'rbac', 'nodes', '']) {
      expect(isListableResource(kind)).toBe(false)
    }
  })
})

describe('parseCpu (millicores)', () => {
  it('normalizes quantities to millicores', () => {
    expect(parseCpu('500m')).toBe(500)
    expect(parseCpu('250m')).toBe(250)
    expect(parseCpu('1')).toBe(1000)
    expect(parseCpu('0.5')).toBe(500)
    expect(parseCpu('')).toBe(0)
    expect(parseCpu('garbage')).toBe(0)
  })
})

describe('parseMem (bytes, rounded)', () => {
  it('normalizes quantities to bytes', () => {
    expect(parseMem('1Gi')).toBe(1024 ** 3)
    expect(parseMem('512Mi')).toBe(512 * 1024 ** 2)
    expect(parseMem('1.5Gi')).toBe(Math.round(1.5 * 1024 ** 3))
    expect(parseMem(' 256Mi ')).toBe(256 * 1024 ** 2)
    expect(parseMem('nope')).toBe(0)
  })
})

describe('mapPod', () => {
  it('maps a running pod to the Pod row shape', () => {
    const pod = {
      metadata: { name: 'api-abc', namespace: 'web', creationTimestamp: new Date() },
      spec: { nodeName: 'node-1', containers: [{ name: 'app' }, { name: 'sidecar' }] },
      status: {
        phase: 'Running',
        podIP: '10.0.0.5',
        containerStatuses: [
          { name: 'app', ready: true, restartCount: 1, state: { running: {} } },
          {
            name: 'sidecar',
            ready: false,
            restartCount: 0,
            state: { waiting: { reason: 'ContainerCreating' } }
          }
        ]
      }
    } as unknown as PodArg
    const row = mapPod(pod)
    expect(row).toMatchObject({
      name: 'api-abc',
      ns: 'web',
      status: 'Running',
      ready: '1/2',
      restarts: 1,
      node: 'node-1',
      ip: '10.0.0.5'
    })
    expect(podKey(row)).toBe('web/api-abc')
    expect(row.containers).toEqual([
      { name: 'app', ready: true, state: 'Running' },
      { name: 'sidecar', ready: false, state: 'ContainerCreating' }
    ])
  })

  it('surfaces a blocking waiting reason as the status', () => {
    const pod = {
      metadata: { name: 'b', namespace: 'd' },
      spec: { containers: [{ name: 'app' }] },
      status: {
        phase: 'Pending',
        containerStatuses: [
          { ready: false, restartCount: 0, state: { waiting: { reason: 'CrashLoopBackOff' } } }
        ]
      }
    } as unknown as PodArg
    expect(mapPod(pod).status).toBe('CrashLoopBackOff')
  })
})

describe('RESOURCE_MAPPERS', () => {
  it('maps a deployment to its ready/up-to-date/available columns', () => {
    const dep = {
      metadata: { uid: 'u1', name: 'web', namespace: 'prod' },
      spec: { replicas: 3 },
      status: { availableReplicas: 2, updatedReplicas: 3 }
    } as unknown as RowArg
    expect(RESOURCE_MAPPERS.deployments(dep)).toMatchObject({
      uid: 'u1',
      name: 'web',
      namespace: 'prod',
      columns: { ready: '2/3', 'up-to-date': '3', available: '2' }
    })
  })

  it('maps a Role to its rule count', () => {
    const role = {
      metadata: { uid: 'r1', name: 'reader', namespace: 'web' },
      rules: [{}, {}, {}]
    } as unknown as RowArg
    expect(RESOURCE_MAPPERS.roles(role).columns).toEqual({ rules: '3' })
  })

  it('maps a CRD, stashing plural/version for instance browsing', () => {
    const crd = {
      metadata: { name: 'widgets.example.com' },
      spec: {
        group: 'example.com',
        names: { kind: 'Widget', plural: 'widgets' },
        scope: 'Namespaced',
        versions: [
          { name: 'v1beta1', served: true, storage: false },
          { name: 'v1', served: true, storage: true }
        ]
      }
    } as unknown as RowArg
    expect(RESOURCE_MAPPERS.crd(crd).columns).toMatchObject({
      group: 'example.com',
      kind: 'Widget',
      scope: 'Namespaced',
      versions: 'v1beta1, v1',
      plural: 'widgets',
      version: 'v1' // storage version
    })
  })

  it('joins service ports and falls back uid to ns/name', () => {
    const svc = {
      metadata: { name: 'svc', namespace: 'net' },
      spec: {
        type: 'ClusterIP',
        clusterIP: '10.1.2.3',
        ports: [{ port: 80 }, { port: 443, protocol: 'TCP' }, { port: 53, protocol: 'UDP' }]
      }
    } as unknown as RowArg
    const row = RESOURCE_MAPPERS.services(svc)
    expect(row.uid).toBe('net/svc') // no metadata.uid → ns/name
    expect(row.columns).toMatchObject({
      type: 'ClusterIP',
      'cluster-ip': '10.1.2.3',
      ports: '80, 443, 53/UDP'
    })
  })
})

describe('watch specs', () => {
  it('has a mapper for every watch spec and vice versa (no drift)', () => {
    expect(Object.keys(WATCH_SPECS).sort()).toEqual(Object.keys(RESOURCE_MAPPERS).sort())
  })
  it('every spec has an absolute API path', () => {
    for (const [kind, spec] of Object.entries(WATCH_SPECS)) {
      expect(spec.path, kind).toMatch(/^\/(api|apis)\//)
    }
  })
  it('exposes the expected paths for representative kinds', () => {
    expect(WATCH_SPECS.deployments.path).toBe('/apis/apps/v1/deployments')
    expect(WATCH_SPECS.services.path).toBe('/api/v1/services')
    expect(WATCH_SPECS.pv.path).toBe('/api/v1/persistentvolumes')
    expect(WATCH_SPECS.ingresses.path).toBe('/apis/networking.k8s.io/v1/ingresses')
  })
  it('does not include pods or nodes (watch.ts special-cases them)', () => {
    expect(WATCH_SPECS.pods).toBeUndefined()
    expect(WATCH_SPECS.nodes).toBeUndefined()
  })
})

describe('mutation GVK contract (no cluster I/O)', () => {
  beforeEach(() => {
    rec.del.length = 0
    rec.patch.length = 0
  })

  it('deleteResource maps the tree id to apiVersion/kind with namespace', async () => {
    await deleteResource('c1', { kind: 'deployments', namespace: 'web', name: 'api' })
    expect(rec.del[0]).toMatchObject({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'api', namespace: 'web' }
    })
  })

  it('deleteResource omits namespace for cluster-scoped kinds (pv)', async () => {
    await deleteResource('c1', { kind: 'pv', name: 'vol-1' })
    expect((rec.del[0].metadata as Record<string, unknown>).namespace).toBeUndefined()
  })

  it('deleteResource rejects unknown kinds', async () => {
    await expect(deleteResource('c1', { kind: 'frobs', name: 'x' })).rejects.toThrow(
      /Unknown resource kind/
    )
  })

  it('rolloutRestart patches a fresh restartedAt annotation', async () => {
    await rolloutRestart('c1', { kind: 'deployments', namespace: 'web', name: 'api' })
    const spec = rec.patch[0].spec as {
      template: { metadata: { annotations: Record<string, string> } }
    }
    const ann = spec.template.metadata.annotations['kubectl.kubernetes.io/restartedAt']
    expect(typeof ann).toBe('string')
    expect(Number.isNaN(Date.parse(ann))).toBe(false)
  })

  it('rolloutRestart rejects non-restartable kinds', async () => {
    await expect(rolloutRestart('c1', { kind: 'services', name: 'svc' })).rejects.toThrow(
      /Not restartable/
    )
  })

  it('scaleResource patches deployment replicas', async () => {
    await scaleResource('c1', { kind: 'deployments', namespace: 'web', name: 'api' }, 5)
    expect(rec.patch.at(-1)).toMatchObject({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'api', namespace: 'web' },
      spec: { replicas: 5 }
    })
  })

  it('scaleResource patches statefulset replicas, including zero', async () => {
    await scaleResource('c1', { kind: 'statefulsets', namespace: 'db', name: 'postgres' }, 0)
    expect(rec.patch.at(-1)).toMatchObject({
      apiVersion: 'apps/v1',
      kind: 'StatefulSet',
      metadata: { name: 'postgres', namespace: 'db' },
      spec: { replicas: 0 }
    })
  })

  it('scaleResource rejects daemonsets and unrelated kinds', async () => {
    await expect(
      scaleResource('c1', { kind: 'daemonsets', namespace: 'kube-system', name: 'agent' }, 2)
    ).rejects.toThrow(/Not scalable/)
    await expect(
      scaleResource('c1', { kind: 'services', namespace: 'web', name: 'svc' }, 2)
    ).rejects.toThrow(/Not scalable/)
  })

  it('scaleResource rejects negative or non-integer replicas', async () => {
    await expect(
      scaleResource('c1', { kind: 'deployments', namespace: 'web', name: 'api' }, -1)
    ).rejects.toThrow(/non-negative integer/)
    await expect(
      scaleResource('c1', { kind: 'deployments', namespace: 'web', name: 'api' }, 1.5)
    ).rejects.toThrow(/non-negative integer/)
  })

  it('createYaml POSTs the parsed manifest via create (not replace)', async () => {
    await createYaml('c1', 'apiVersion: apps/v1\nkind: Deployment')
    expect(rec.create.at(-1)).toEqual({ __yaml: 'apiVersion: apps/v1\nkind: Deployment' })
    expect(rec.patch).toHaveLength(0)
  })

  it('cordonNode patches the node as unschedulable', async () => {
    await cordonNode('c1', 'node-1')
    expect(rec.patch.at(-1)).toMatchObject({
      apiVersion: 'v1',
      kind: 'Node',
      metadata: { name: 'node-1' },
      spec: { unschedulable: true }
    })
  })

  it('uncordonNode clears the unschedulable flag', async () => {
    await uncordonNode('c1', 'node-1')
    expect((rec.patch.at(-1)!.spec as { unschedulable: boolean }).unschedulable).toBe(false)
  })
})

describe('isEvictable (drain filtering)', () => {
  it('skips DaemonSet-owned pods', () => {
    expect(isEvictable({ metadata: { ownerReferences: [{ kind: 'DaemonSet' }] } } as never)).toBe(
      false
    )
  })
  it('skips mirror (static) pods', () => {
    expect(
      isEvictable({ metadata: { annotations: { 'kubernetes.io/config.mirror': 'abc' } } } as never)
    ).toBe(false)
  })
  it('skips completed pods', () => {
    expect(isEvictable({ status: { phase: 'Succeeded' } } as never)).toBe(false)
    expect(isEvictable({ status: { phase: 'Failed' } } as never)).toBe(false)
  })
  it('evicts a normal running pod', () => {
    expect(
      isEvictable({
        metadata: { name: 'p', ownerReferences: [{ kind: 'ReplicaSet' }] },
        status: { phase: 'Running' }
      } as never)
    ).toBe(true)
  })
})
