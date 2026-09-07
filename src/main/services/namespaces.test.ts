import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  core: {} as Record<string, ReturnType<typeof vi.fn>>,
  networking: {} as Record<string, ReturnType<typeof vi.fn>>,
  created: [] as unknown[],
  deleted: [] as string[]
}))

vi.mock('./k8s', () => ({
  ageOf: () => '2d',
  kcForCluster: async () => ({
    makeApiClient: (api: { api: string }) =>
      api.api === 'networking' ? mocks.networking : mocks.core
  }),
  loadK8s: async () => ({
    CoreV1Api: { api: 'core' },
    NetworkingV1Api: { api: 'networking' },
    quantityToScalar: (value: string) => {
      if (value.endsWith('Gi')) return Number(value.slice(0, -2)) * 1024 ** 3
      return Number(value)
    },
    loadYaml: (yaml: string) =>
      yaml.includes('kind: Namespace')
        ? { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'yaml-team' } }
        : { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'bad' } }
  })
}))

import {
  createNamespace,
  deleteNamespace,
  isNamespaceProtected,
  listNamespaceSummaries,
  getNamespaceDetail,
  mapNetworkPolicy,
  podStates
} from './namespaces'

const namespace = {
  metadata: { name: 'team-a', uid: 'n1', creationTimestamp: new Date('2026-09-05') },
  status: { phase: 'Active' }
}
const readyPod = {
  metadata: { namespace: 'team-a' },
  status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] }
}

describe('namespace aggregation', () => {
  beforeEach(() => {
    mocks.created.length = 0
    mocks.deleted.length = 0
    mocks.core = {
      listNamespace: vi.fn(async () => ({ items: [namespace] })),
      listPodForAllNamespaces: vi.fn(async () => ({ items: [readyPod] })),
      listResourceQuotaForAllNamespaces: vi.fn(async () => ({
        items: [{ metadata: { namespace: 'team-a' } }]
      })),
      listLimitRangeForAllNamespaces: vi.fn(async () => ({ items: [] })),
      readNamespace: vi.fn(async () => namespace),
      listNamespacedPod: vi.fn(async () => ({
        items: [readyPod, { metadata: { namespace: 'team-a' }, status: { phase: 'Pending' } }]
      })),
      listNamespacedResourceQuota: vi.fn(async () => ({
        items: [
          {
            metadata: { name: 'compute' },
            spec: { hard: { 'requests.cpu': '4' } },
            status: { used: { 'requests.cpu': '2' } }
          }
        ]
      })),
      listNamespacedLimitRange: vi.fn(async () => ({ items: [] })),
      createNamespace: vi.fn(async ({ body }) => {
        mocks.created.push(body)
      }),
      deleteNamespace: vi.fn(async ({ name }) => {
        mocks.deleted.push(name)
      })
    }
    mocks.networking = {
      listNetworkPolicyForAllNamespaces: vi.fn(async () => ({
        items: [
          {
            metadata: { namespace: 'team-a' },
            spec: { podSelector: {}, policyTypes: ['Ingress'], ingress: [] }
          }
        ]
      })),
      listNamespacedNetworkPolicy: vi.fn(async () => ({
        items: [
          {
            metadata: { name: 'deny' },
            spec: { podSelector: {}, policyTypes: ['Ingress'], ingress: [] }
          }
        ]
      }))
    }
  })

  it('computes readiness, governance counts, and default-deny declarations', async () => {
    const result = await listNamespaceSummaries('cluster')
    expect(result.items[0]).toMatchObject({
      podsReady: 1,
      podsTotal: 1,
      quotaCount: 1,
      limitRangeCount: 0,
      networkPolicyCount: 1,
      defaultDenyIngress: true
    })
    expect(result.access.policies.available).toBe(true)
  })

  it('preserves the list when one optional API is forbidden', async () => {
    mocks.networking.listNetworkPolicyForAllNamespaces.mockRejectedValueOnce(new Error('Forbidden'))
    const result = await listNamespaceSummaries('cluster')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].networkPolicyCount).toBeNull()
    expect(result.access.policies).toMatchObject({ available: false, message: 'Forbidden' })
  })

  it('maps detail pod states and quota percentages', async () => {
    const result = await getNamespaceDetail('cluster', 'team-a')
    expect(result.podStates).toMatchObject({ total: 2, ready: 1, running: 1, pending: 1 })
    expect(result.quotas?.[0].resources[0]).toEqual({
      resource: 'requests.cpu',
      used: '2',
      hard: '4',
      percent: 50
    })
  })
})

describe('namespace safety and validation', () => {
  beforeEach(() => {
    mocks.core.createNamespace = vi.fn(async ({ body }) => {
      mocks.created.push(body)
    })
    mocks.core.deleteNamespace = vi.fn(async ({ name }) => {
      mocks.deleted.push(name)
    })
  })

  it('recognizes every protected namespace pattern', () => {
    expect(isNamespaceProtected('default')).toBe(true)
    expect(isNamespaceProtected('kube-system')).toBe(true)
    expect(isNamespaceProtected('team-a')).toBe(false)
  })

  it('creates validated form and Namespace YAML payloads', async () => {
    await createNamespace('cluster', { mode: 'form', name: 'team-a', labels: { team: 'platform' } })
    await createNamespace('cluster', { mode: 'yaml', yaml: 'apiVersion: v1\nkind: Namespace' })
    expect(mocks.created).toHaveLength(2)
    await expect(createNamespace('cluster', { mode: 'yaml', yaml: 'kind: Pod' })).rejects.toThrow(
      /Namespace object/
    )
  })

  it('blocks protected deletion in the backend', async () => {
    await expect(deleteNamespace('cluster', 'default')).rejects.toThrow(/protected/)
    await expect(deleteNamespace('cluster', 'kube-public')).rejects.toThrow(/protected/)
    await deleteNamespace('cluster', 'team-a')
    expect(mocks.deleted).toEqual(['team-a'])
  })
})

describe('namespace helpers', () => {
  it('requires Ready=True and detects all-pod default deny', () => {
    expect(
      podStates([
        readyPod as never,
        { status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'False' }] } } as never
      ])
    ).toMatchObject({ total: 2, ready: 1 })
    expect(
      mapNetworkPolicy({
        metadata: { name: 'deny' },
        spec: { podSelector: {}, policyTypes: ['Ingress', 'Egress'], ingress: [], egress: [] }
      } as never)
    ).toMatchObject({ defaultDenyIngress: true, defaultDenyEgress: true, selector: '<all pods>' })
  })
})
