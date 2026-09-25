import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import type { V1Pod } from '@kubernetes/client-node'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  evict: vi.fn(),
  cordon: vi.fn(),
  activity: vi.fn()
}))

vi.mock('./resource-mutations', () => ({
  cordonNode: mocks.cordon,
  isEvictable: (pod: V1Pod) =>
    !pod.metadata?.ownerReferences?.some((owner) => owner.kind === 'DaemonSet') &&
    !pod.metadata?.annotations?.['kubernetes.io/config.mirror'] &&
    pod.status?.phase !== 'Succeeded' &&
    pod.status?.phase !== 'Failed'
}))
vi.mock('./activity', () => ({ recordActivity: mocks.activity }))
vi.mock('./k8s', () => ({
  loadK8s: async () => ({ CoreV1Api: class {} }),
  kcForCluster: async () => ({
    makeApiClient: () => ({
      listPodForAllNamespaces: mocks.list,
      createNamespacedPodEviction: mocks.evict
    })
  })
}))

import { cancelDrain, drainNode, startDrain } from './node-drain'

const pod = (name: string, extra: Partial<V1Pod> = {}): V1Pod =>
  ({
    metadata: {
      name,
      namespace: 'work',
      uid: name,
      ownerReferences: [
        { apiVersion: 'apps/v1', kind: 'ReplicaSet', name: 'app', uid: 'owner', controller: true }
      ]
    },
    spec: { containers: [{ name: 'app' }] },
    ...extra
  }) as V1Pod

class Sender extends EventEmitter {
  id = 10
  destroyed = false
  send = vi.fn()
  isDestroyed = (): boolean => this.destroyed
  close(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.list.mockReset()
  mocks.evict.mockReset().mockResolvedValue({})
  mocks.cordon.mockReset().mockResolvedValue(undefined)
  mocks.activity.mockReset().mockResolvedValue({ id: 'activity-1' })
})
afterEach(() => vi.useRealTimers())

describe('drainNode', () => {
  it('reports completion only after a fresh list shows the pod gone', async () => {
    const running = pod('api')
    mocks.list.mockResolvedValueOnce({ items: [running] }).mockResolvedValueOnce({ items: [] })
    const progress = vi.fn()
    const pending = drainNode('cluster', 'node-a', new AbortController().signal, progress)
    await vi.advanceTimersByTimeAsync(2_000)
    const result = await pending

    expect(result.status).toBe('completed')
    expect(result.remaining).toEqual([])
    expect(result.pods).toContainEqual({ namespace: 'work', name: 'api', status: 'removed' })
    expect(mocks.evict).toHaveBeenCalledOnce()
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('waiting for removal') })
    )
  })

  it('preflights unmanaged and emptyDir pods before any eviction', async () => {
    const unmanaged = pod('loose', { metadata: { name: 'loose', namespace: 'work' } })
    const local = pod('cache', {
      spec: { containers: [{ name: 'app' }], volumes: [{ name: 'data', emptyDir: {} }] }
    })
    mocks.list.mockResolvedValue({ items: [pod('api'), unmanaged, local] })
    const result = await drainNode('cluster', 'node-a', new AbortController().signal, vi.fn())

    expect(result.status).toBe('failed')
    expect(result.reason).toContain('blocked')
    expect(result.pods.filter((item) => item.status === 'blocked')).toHaveLength(2)
    expect(result.remaining).toHaveLength(3)
    expect(mocks.evict).not.toHaveBeenCalled()
  })

  it('keeps DaemonSet, mirror, and completed pods outside the completion check', async () => {
    mocks.list.mockResolvedValue({
      items: [
        pod('daemon', {
          metadata: {
            name: 'daemon',
            namespace: 'work',
            ownerReferences: [{ apiVersion: 'apps/v1', kind: 'DaemonSet', name: 'ds', uid: 'ds' }]
          }
        }),
        pod('static', {
          metadata: {
            name: 'static',
            namespace: 'work',
            annotations: { 'kubernetes.io/config.mirror': 'x' }
          }
        }),
        pod('done', { status: { phase: 'Succeeded' } })
      ]
    })
    const result = await drainNode('cluster', 'node-a', new AbortController().signal, vi.fn())
    expect(result.status).toBe('completed')
    expect(result.pods.map((item) => item.status)).toEqual(['skipped', 'skipped', 'skipped'])
    expect(mocks.evict).not.toHaveBeenCalled()
  })

  it('retries HTTP 429 but never reports success from an accepted request alone', async () => {
    mocks.list
      .mockResolvedValueOnce({ items: [pod('api')] })
      .mockResolvedValueOnce({ items: [pod('api')] })
      .mockResolvedValueOnce({ items: [] })
    mocks.evict.mockRejectedValueOnce({ statusCode: 429 }).mockResolvedValueOnce({})
    const pending = drainNode('cluster', 'node-a', new AbortController().signal, vi.fn())
    await vi.advanceTimersByTimeAsync(4_000)
    expect((await pending).status).toBe('completed')
    expect(mocks.evict).toHaveBeenCalledTimes(2)
  })

  it('times out repeated disruption-budget rejections with the pod still present', async () => {
    mocks.list.mockResolvedValue({ items: [pod('api')] })
    mocks.evict.mockRejectedValue({ statusCode: 429 })
    const pending = drainNode('cluster', 'node-a', new AbortController().signal, vi.fn())
    await vi.advanceTimersByTimeAsync(300_000)
    const result = await pending
    expect(result.status).toBe('timed-out')
    expect(result.remaining).toContainEqual(
      expect.objectContaining({ name: 'api', status: 'remaining' })
    )
    expect(mocks.evict.mock.calls.length).toBeGreaterThan(1)
  })

  it('discovers and evicts a new eligible pod before completing', async () => {
    mocks.list
      .mockResolvedValueOnce({ items: [pod('api')] })
      .mockResolvedValueOnce({ items: [pod('new')] })
      .mockResolvedValueOnce({ items: [] })
    const pending = drainNode('cluster', 'node-a', new AbortController().signal, vi.fn())
    await vi.advanceTimersByTimeAsync(4_000)
    expect((await pending).status).toBe('completed')
    expect(mocks.evict).toHaveBeenCalledTimes(2)
  })

  it('blocks missing pod identity before any eviction', async () => {
    mocks.list.mockResolvedValue({ items: [pod('api'), pod('bad', { metadata: {} })] })
    const result = await drainNode('cluster', 'node-a', new AbortController().signal, vi.fn())
    expect(result.status).toBe('failed')
    expect(result.pods).toContainEqual(
      expect.objectContaining({ status: 'blocked', reason: 'Pod identity is missing' })
    )
    expect(mocks.evict).not.toHaveBeenCalled()
  })

  it('reports forbidden evictions and preserves the remaining pod', async () => {
    mocks.list.mockResolvedValue({ items: [pod('api')] })
    mocks.evict.mockRejectedValue({ statusCode: 403 })
    const result = await drainNode('cluster', 'node-a', new AbortController().signal, vi.fn())
    expect(result.status).toBe('failed')
    expect(result.remaining).toHaveLength(1)
    expect(result.pods).toContainEqual(expect.objectContaining({ status: 'failed' }))
  })

  it('times out a stalled Kubernetes request', async () => {
    mocks.list.mockReturnValue(new Promise(() => undefined))
    const pending = drainNode('cluster', 'node-a', new AbortController().signal, vi.fn())
    await vi.advanceTimersByTimeAsync(15_000)
    expect((await pending).status).toBe('timed-out')
  })

  it('does not claim a cordon succeeded when cancelled during its request', async () => {
    mocks.cordon.mockReturnValue(new Promise(() => undefined))
    const controller = new AbortController()
    const pending = drainNode('cluster', 'node-a', controller.signal, vi.fn())
    controller.abort()
    const result = await pending
    expect(result.status).toBe('cancelled')
    expect(result.reason).toContain('schedulability is unknown')
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('cancels an in-flight request and reports last observed pods', async () => {
    mocks.list
      .mockResolvedValueOnce({ items: [pod('api')] })
      .mockReturnValueOnce(new Promise(() => undefined))
    const controller = new AbortController()
    const pending = drainNode('cluster', 'node-a', controller.signal, vi.fn())
    await vi.advanceTimersByTimeAsync(2_000)
    controller.abort()
    const result = await pending
    expect(result.status).toBe('cancelled')
    expect(result.remaining).toHaveLength(1)
    expect(mocks.evict).toHaveBeenCalledOnce()
  })
})

describe('drain session ownership', () => {
  it('rejects duplicate nodes and ignores cancellation from another sender', async () => {
    mocks.list.mockReturnValue(new Promise(() => undefined))
    const sender = new Sender()
    const other = new Sender()
    other.id = 11
    const pending = startDrain(sender as unknown as WebContents, 'one', 'cluster', 'node-a')
    await expect(
      startDrain(other as unknown as WebContents, 'two', 'cluster', 'node-a')
    ).rejects.toThrow('already active')
    cancelDrain(other as unknown as WebContents, 'one')
    expect(mocks.activity).not.toHaveBeenCalled()
    cancelDrain(sender as unknown as WebContents, 'one')
    expect((await pending).status).toBe('cancelled')
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error' }))
  })

  it('cancels on sender destruction and releases ownership', async () => {
    mocks.list
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce({ items: [] })
    const sender = new Sender()
    const pending = startDrain(sender as unknown as WebContents, 'one', 'cluster', 'node-a')
    await vi.advanceTimersByTimeAsync(0)
    sender.close()
    expect((await pending).status).toBe('cancelled')
    const next = await startDrain(
      new Sender() as unknown as WebContents,
      'two',
      'cluster',
      'node-a'
    )
    expect(next.status).toBe('completed')
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }))
  })

  it('keeps the Kubernetes outcome separate from activity persistence failure', async () => {
    mocks.list.mockResolvedValue({ items: [] })
    mocks.activity.mockRejectedValue(new Error('disk full'))
    const result = await startDrain(
      new Sender() as unknown as WebContents,
      'three',
      'cluster',
      'node-a'
    )
    expect(result.status).toBe('completed')
    expect(result.activityError).toContain('disk full')
  })
})
