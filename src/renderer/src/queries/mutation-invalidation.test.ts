import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { qk } from './keys'
import { invalidateMutation } from './mutation-invalidation'

const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const prime = (client: QueryClient, ...keys: ReadonlyArray<readonly unknown[]>): void => {
  for (const key of keys) client.setQueryData(key, {})
}
const stale = (client: QueryClient, key: readonly unknown[]): boolean =>
  client.getQueryCache().find({ queryKey: key, exact: true })?.state.isInvalidated ?? false

describe('mutation invalidation', () => {
  it('refetches an active related view immediately', async () => {
    const client = qc()
    const ref = { kind: 'configmaps', namespace: 'web', name: 'settings' }
    const key = qk.detail('a', ref)
    let reads = 0
    await client.fetchQuery({ queryKey: key, queryFn: async () => ++reads })
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: async () => ++reads,
      staleTime: Infinity
    })
    const unsubscribe = observer.subscribe(() => {})
    await invalidateMutation(client, 'a', { type: 'resource', operation: 'apply', refs: [ref] })
    expect(reads).toBe(2)
    unsubscribe()
  })

  it('refreshes a YAML edit across detail, data, list, events, and summaries in one cluster', async () => {
    const client = qc()
    const ref = { kind: 'configmaps', namespace: 'web', name: 'settings' }
    const keys = [
      qk.yaml('a', ref),
      qk.detail('a', ref),
      qk.configData('a', ref),
      qk.resource('a', 'configmaps'),
      qk.events('a', ref),
      qk.overview('a'),
      qk.overviewBundle('a'),
      qk.namespaceSummaries('a'),
      qk.namespaceDetail('a', 'web')
    ]
    const other = qk.configData('b', ref)
    const otherEvent = qk.events('b', ref)
    prime(client, ...keys, other, otherEvent)
    await invalidateMutation(client, 'a', { type: 'resource', operation: 'apply', refs: [ref] })
    for (const key of keys) expect(stale(client, key), JSON.stringify(key)).toBe(true)
    expect(stale(client, other)).toBe(false)
    expect(stale(client, otherEvent)).toBe(false)
  })

  it('keeps data-only edits from refreshing unrelated overview counts', async () => {
    const client = qc()
    const ref = { kind: 'secrets', namespace: 'web', name: 'token' }
    prime(client, qk.configData('a', ref), qk.yaml('a', ref), qk.detail('a', ref), qk.overview('a'))
    await invalidateMutation(client, 'a', { type: 'resource', operation: 'data', refs: [ref] })
    expect(stale(client, qk.configData('a', ref))).toBe(true)
    expect(stale(client, qk.yaml('a', ref))).toBe(true)
    expect(stale(client, qk.detail('a', ref))).toBe(true)
    expect(stale(client, qk.overview('a'))).toBe(false)
  })

  it('refreshes node and pod views for generic node and workload YAML edits', async () => {
    const client = qc()
    const node = { kind: 'nodes', name: 'node-a' }
    const deployment = { kind: 'deployments', namespace: 'web', name: 'api' }
    prime(client, qk.nodes('a'), qk.nodeDetail('a', 'node-a'), qk.pods('a'))
    await invalidateMutation(client, 'a', {
      type: 'resource',
      operation: 'apply',
      refs: [node, deployment]
    })
    expect(stale(client, qk.nodes('a'))).toBe(true)
    expect(stale(client, qk.nodeDetail('a', 'node-a'))).toBe(true)
    expect(stale(client, qk.pods('a'))).toBe(true)
  })

  it('refreshes only changed references in a partial bulk operation', async () => {
    const client = qc()
    const first = { kind: 'deployments', namespace: 'web', name: 'api' }
    const second = { kind: 'deployments', namespace: 'web', name: 'worker' }
    prime(client, qk.yaml('a', first), qk.yaml('a', second), qk.resource('a', 'deployments'))
    await invalidateMutation(client, 'a', {
      type: 'resource',
      operation: 'scale',
      refs: [first]
    })
    expect(stale(client, qk.yaml('a', first))).toBe(true)
    expect(stale(client, qk.yaml('a', second))).toBe(false)
    expect(stale(client, qk.resource('a', 'deployments'))).toBe(true)
  })

  it('targets the custom API group and version; CRD edits refresh all custom lists', async () => {
    const client = qc()
    const widgets = qk.customResource('a', {
      group: 'example.com',
      version: 'v1',
      plural: 'widgets',
      namespaced: true
    })
    const gadgets = qk.customResource('a', {
      group: 'example.com',
      version: 'v1',
      plural: 'gadgets',
      namespaced: true
    })
    const others = qk.customResource('a', {
      group: 'other.com',
      version: 'v1',
      plural: 'items',
      namespaced: true
    })
    prime(client, widgets, gadgets, others)
    await invalidateMutation(client, 'a', {
      type: 'resource',
      operation: 'apply',
      refs: [{ kind: 'Widget', apiVersion: 'example.com/v1', namespace: 'web', name: 'x' }]
    })
    expect(stale(client, widgets)).toBe(true)
    expect(stale(client, gadgets)).toBe(true)
    expect(stale(client, others)).toBe(false)

    await invalidateMutation(client, 'a', {
      type: 'resource',
      operation: 'apply',
      refs: [{ kind: 'crd', name: 'widgets.example.com' }]
    })
    expect(stale(client, others)).toBe(true)
  })

  it('refreshes namespace-scoped details and lists after deletion', async () => {
    const client = qc()
    const web = { kind: 'secrets', namespace: 'web', name: 'token' }
    const other = { kind: 'secrets', namespace: 'other', name: 'token' }
    const keys = [
      qk.yaml('a', web),
      qk.detail('a', web),
      qk.configData('a', web),
      qk.resource('a', 'deployments'),
      qk.pods('a'),
      qk.namespaceSummaries('a')
    ]
    prime(client, ...keys, qk.yaml('a', other))
    await invalidateMutation(client, 'a', {
      type: 'namespace',
      operation: 'delete',
      names: ['web']
    })
    for (const key of keys) expect(stale(client, key), JSON.stringify(key)).toBe(true)
    expect(stale(client, qk.yaml('a', other))).toBe(false)
  })

  it('treats generic namespace deletion like the dedicated namespace action', async () => {
    const client = qc()
    const deleted = { kind: 'configmaps', namespace: 'web', name: 'settings' }
    prime(client, qk.yaml('a', deleted), qk.resource('a', 'configmaps'))
    await invalidateMutation(client, 'a', {
      type: 'resource',
      operation: 'delete',
      refs: [{ kind: 'namespaces', name: 'web' }]
    })
    expect(stale(client, qk.yaml('a', deleted))).toBe(true)
    expect(stale(client, qk.resource('a', 'configmaps'))).toBe(true)
  })

  it('refreshes nodes, pods, workloads, and affected namespaces after a partial drain', async () => {
    const client = qc()
    const keys = [
      qk.nodes('a'),
      qk.nodeDetail('a', 'node-a'),
      qk.pods('a'),
      qk.resource('a', 'deployments'),
      qk.overviewBundle('a'),
      qk.namespaceSummaries('a'),
      qk.namespaceDetail('a', 'web')
    ]
    prime(client, ...keys, qk.nodeDetail('b', 'node-a'))
    await invalidateMutation(client, 'a', {
      type: 'node',
      operation: 'drain',
      names: ['node-a'],
      namespaces: ['web']
    })
    for (const key of keys) expect(stale(client, key), JSON.stringify(key)).toBe(true)
    expect(stale(client, qk.nodeDetail('b', 'node-a'))).toBe(false)
  })
})
