import { describe, expect, it, vi } from 'vitest'

// Mock ./k8s so importing watch.ts (and resources.ts via it) loads neither the
// real @kubernetes/client-node nor electron. The live informer behaviour itself
// needs a real cluster and is runbook-verified (like live-smoke.test.ts); here we
// assert the pure spec resolution that determines what each kind watches.
vi.mock('./k8s', () => ({
  ageOf: () => '',
  kcForCluster: async () => ({}),
  loadK8s: async () => ({})
}))

import { specFor } from './watch'

describe('specFor', () => {
  it('special-cases pods and nodes with their core API paths', () => {
    expect(specFor('pods')?.path).toBe('/api/v1/pods')
    expect(specFor('nodes')?.path).toBe('/api/v1/nodes')
    expect(typeof specFor('pods')?.map).toBe('function')
    expect(typeof specFor('nodes')?.map).toBe('function')
  })

  it('resolves resource kinds from the shared watch specs (incl. RBAC + CRD)', () => {
    expect(specFor('deployments')?.path).toBe('/apis/apps/v1/deployments')
    expect(specFor('roles')?.path).toBe('/apis/rbac.authorization.k8s.io/v1/roles')
    expect(specFor('crd')?.path).toBe('/apis/apiextensions.k8s.io/v1/customresourcedefinitions')
    expect(typeof specFor('deployments')?.map).toBe('function')
  })

  it('returns null for bespoke/non-watchable kinds (helm) and unknown kinds', () => {
    expect(specFor('helm')).toBeNull()
    expect(specFor('')).toBeNull()
  })

  it('node mapper produces a structural NodeRow with zeroed metrics', () => {
    const row = specFor('nodes')!.map({
      metadata: { name: 'n1', labels: { 'node-role.kubernetes.io/control-plane': '' } },
      status: {
        conditions: [{ type: 'Ready', status: 'True' }],
        nodeInfo: { kubeletVersion: 'v1.30.0' },
        allocatable: { pods: '110' }
      }
    } as never) as {
      name: string
      roles: string[]
      status: string
      cpuPct: number
      pods: number
      maxPods: number
      ver: string
    }
    expect(row.name).toBe('n1')
    expect(row.roles).toEqual(['control-plane'])
    expect(row.status).toBe('Ready')
    expect(row.cpuPct).toBe(0) // metrics are polled separately, not watched
    expect(row.pods).toBe(0)
    expect(row.maxPods).toBe(110)
    expect(row.ver).toBe('v1.30.0')
  })
})
