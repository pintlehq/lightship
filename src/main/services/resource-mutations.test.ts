import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KubernetesObject } from '@kubernetes/client-node'

const mocks = vi.hoisted(() => ({
  kcForCluster: vi.fn(async () => ({})),
  makeApiClient: vi.fn(),
  replace: vi.fn(async (_object: KubernetesObject) => undefined)
}))

vi.mock('./k8s', () => ({
  kcForCluster: mocks.kcForCluster,
  loadK8s: async () => ({
    loadYaml: (await import('@kubernetes/client-node')).loadYaml,
    KubernetesObjectApi: { makeApiClient: mocks.makeApiClient }
  })
}))

import type { ResourceRef } from '../../shared/ipc-types'
import { applyYaml } from './resource-mutations'

const deployment: ResourceRef = { kind: 'deployments', namespace: 'web', name: 'api' }
const manifest = (
  overrides: {
    apiVersion?: string
    kind?: string
    name?: string
    namespace?: string | null
    resourceVersion?: string | null
  } = {}
): string => {
  const namespace = overrides.namespace === undefined ? 'web' : overrides.namespace
  const resourceVersion =
    overrides.resourceVersion === undefined ? '123' : overrides.resourceVersion
  return [
    `apiVersion: ${overrides.apiVersion ?? 'apps/v1'}`,
    `kind: ${overrides.kind ?? 'Deployment'}`,
    'metadata:',
    `  name: ${overrides.name ?? 'api'}`,
    ...(namespace === null ? [] : [`  namespace: ${namespace}`]),
    ...(resourceVersion === null ? [] : [`  resourceVersion: '${resourceVersion}'`]),
    'spec:',
    '  replicas: 3'
  ].join('\n')
}

beforeEach(() => {
  mocks.kcForCluster.mockClear()
  mocks.makeApiClient.mockReset().mockReturnValue({ replace: mocks.replace })
  mocks.replace.mockReset().mockResolvedValue(undefined)
})

describe('applyYaml identity and concurrency', () => {
  it('replaces the selected namespaced object and preserves other fields and version', async () => {
    await applyYaml('cluster-a', deployment, manifest())

    expect(mocks.makeApiClient).toHaveBeenCalledOnce()
    expect(mocks.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: expect.objectContaining({
          name: 'api',
          namespace: 'web',
          resourceVersion: '123'
        }),
        spec: expect.objectContaining({ replicas: 3 })
      })
    )
  })

  it('accepts cluster-scoped and custom-resource identities', async () => {
    await applyYaml(
      'cluster-a',
      { kind: 'pv', name: 'disk-a' },
      'apiVersion: v1\nkind: PersistentVolume\nmetadata:\n  name: disk-a\n  resourceVersion: "7"'
    )
    await applyYaml(
      'cluster-a',
      { kind: 'Widget', apiVersion: 'example.com/v1', namespace: 'web', name: 'thing' },
      'apiVersion: example.com/v1\nkind: Widget\nmetadata:\n  name: thing\n  namespace: web\n  resourceVersion: "8"\nspec:\n  color: blue'
    )
    expect(mocks.replace).toHaveBeenCalledTimes(2)
    expect(mocks.replace).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ metadata: expect.objectContaining({ name: 'disk-a' }) })
    )
    expect(mocks.replace).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ spec: expect.objectContaining({ color: 'blue' }) })
    )
  })

  it.each([
    ['API version', manifest({ apiVersion: 'v1' }), /apiVersion must match/],
    ['kind', manifest({ kind: 'StatefulSet' }), /kind must match/],
    ['name', manifest({ name: 'other' }), /metadata.name must match/],
    ['namespace', manifest({ namespace: 'other' }), /metadata.namespace must match/],
    ['missing namespace', manifest({ namespace: null }), /metadata.namespace is required/],
    ['missing version', manifest({ resourceVersion: null }), /resourceVersion is required/],
    ['empty version', manifest({ resourceVersion: '' }), /resourceVersion is required/],
    [
      'numeric version',
      manifest().replace("resourceVersion: '123'", 'resourceVersion: 123'),
      /resourceVersion is required/
    ],
    ['missing API version', 'kind: Deployment\nmetadata:\n  name: api', /apiVersion is required/],
    ['missing kind', 'apiVersion: apps/v1\nmetadata:\n  name: api', /kind is required/],
    [
      'missing name',
      'apiVersion: apps/v1\nkind: Deployment\nmetadata: {}',
      /metadata.name is required/
    ],
    ['missing metadata', 'apiVersion: apps/v1\nkind: Deployment', /metadata is required/],
    ['empty YAML', '', /Invalid YAML manifest/],
    ['scalar YAML', 'hello', /one Kubernetes object/],
    ['array YAML', '- hello', /one Kubernetes object/],
    ['multiple documents', `${manifest()}\n---\n${manifest()}`, /Invalid YAML manifest/],
    ['malformed YAML', 'metadata: [', /Invalid YAML manifest/]
  ])('rejects %s before creating a Kubernetes client', async (_label, yaml, error) => {
    await expect(applyYaml('cluster-a', deployment, yaml)).rejects.toThrow(error)
    expect(mocks.kcForCluster).not.toHaveBeenCalled()
    expect(mocks.makeApiClient).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('rejects missing selected namespace and unknown kinds locally', async () => {
    await expect(
      applyYaml('cluster-a', { kind: 'deployments', name: 'api' }, manifest())
    ).rejects.toThrow(/Selected resource namespace is required/)
    await expect(
      applyYaml('cluster-a', { kind: 'Unknown', name: 'x' }, manifest())
    ).rejects.toThrow(/Unknown resource kind/)
    expect(mocks.makeApiClient).not.toHaveBeenCalled()
  })

  it('rejects namespaces on cluster-scoped resources', async () => {
    await expect(
      applyYaml(
        'cluster-a',
        { kind: 'pv', name: 'disk-a' },
        'apiVersion: v1\nkind: PersistentVolume\nmetadata:\n  name: disk-a\n  namespace: web\n  resourceVersion: "7"'
      )
    ).rejects.toThrow(/must not specify metadata.namespace/)
    await expect(
      applyYaml(
        'cluster-a',
        { kind: 'pv', name: 'disk-a' },
        'apiVersion: v1\nkind: PersistentVolume\nmetadata:\n  name: disk-a\n  namespace: null\n  resourceVersion: "7"'
      )
    ).rejects.toThrow(/must not specify metadata.namespace/)
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('turns version conflicts into a reload message and preserves other errors', async () => {
    mocks.replace.mockRejectedValueOnce({ code: 409 }).mockRejectedValueOnce(new Error('Forbidden'))
    await expect(applyYaml('cluster-a', deployment, manifest())).rejects.toThrow(
      /Reload and review/
    )
    await expect(applyYaml('cluster-a', deployment, manifest())).rejects.toThrow('Forbidden')
  })
})
