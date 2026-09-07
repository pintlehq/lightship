import { EventEmitter } from 'node:events'
import { Readable, type Writable } from 'node:stream'
import { ReadableStream } from 'node:stream/web'

import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  log: vi.fn(),
  readPod: vi.fn()
}))

vi.mock('./k8s', () => {
  class Log {
    log(
      namespace: string,
      pod: string,
      container: string,
      stream: Writable,
      options: unknown
    ): Promise<AbortController> {
      return mocks.log(namespace, pod, container, stream, options)
    }
  }

  return {
    kcForCluster: async () => ({
      makeApiClient: () => ({ readNamespacedPod: mocks.readPod })
    }),
    loadK8s: async () => ({ CoreV1Api: class {}, Log })
  }
})

import { startLogStream, stopLogStream } from './logs'

const SUB_ID = 'logs:test'
const REF = { kind: 'pods', namespace: 'default', name: 'pod-1' }

type FakeSender = WebContents & {
  send: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
}

function fakeSender(): FakeSender {
  return Object.assign(new EventEmitter(), {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false)
  }) as unknown as FakeSender
}

function pipeHiddenSource(stream: Writable): Readable {
  const source = new Readable({ read: () => {} })
  source.pipe(stream)
  return source
}

function pipeAbortableWebSource(stream: Writable, controller: AbortController): Readable {
  const body = new ReadableStream<Uint8Array>({
    start(bodyController) {
      controller.signal.addEventListener('abort', () =>
        bodyController.error(controller.signal.reason)
      )
    }
  })
  const source = Readable.fromWeb(body)
  source.pipe(stream)
  return source
}

const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  mocks.log.mockReset()
  mocks.readPod.mockReset().mockResolvedValue({
    metadata: { name: 'pod-1', namespace: 'default' },
    spec: { containers: [{ name: 'app' }] }
  })
})

afterEach(() => {
  stopLogStream(SUB_ID)
  vi.useRealTimers()
})

describe('log stream lifecycle', () => {
  it('handles the source AbortError when an active stream is stopped', async () => {
    const sender = fakeSender()
    const controller = new AbortController()
    let source: Readable | undefined

    mocks.log.mockImplementation(async (_ns, _pod, _container, stream: Writable) => {
      source = pipeAbortableWebSource(stream, controller)
      return controller
    })

    await startLogStream(sender, SUB_ID, 'cluster-1', REF, {})

    expect(source?.listenerCount('error')).toBeGreaterThan(0)
    expect(sender.listenerCount('destroyed')).toBe(1)

    stopLogStream(SUB_ID)
    stopLogStream(SUB_ID)
    await nextTurn()

    expect(controller.signal.aborted).toBe(true)
    expect(source?.destroyed).toBe(true)
    expect(sender.listenerCount('destroyed')).toBe(0)
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('reports an unexpected source failure inside the affected log stream', async () => {
    vi.useFakeTimers()
    const sender = fakeSender()
    let source: Readable | undefined

    mocks.log.mockImplementation(async (_ns, _pod, _container, stream: Writable) => {
      source = pipeHiddenSource(stream)
      return new AbortController()
    })

    await startLogStream(sender, SUB_ID, 'cluster-1', REF, {})
    source?.emit('error', new Error('socket reset'))
    await vi.advanceTimersByTimeAsync(120)

    expect(sender.send).toHaveBeenCalledWith(`cluster:logs:${SUB_ID}`, {
      type: 'lines',
      items: [
        {
          pod: 'pod-1',
          container: 'app',
          ts: '',
          msg: 'failed to stream: socket reset'
        }
      ]
    })
  })

  it('does not resurrect or emit from a stream stopped while opening', async () => {
    const sender = fakeSender()
    const controller = new AbortController()
    let resolveController: ((controller: AbortController) => void) | undefined
    let source: Readable | undefined

    mocks.log.mockImplementation(
      (_ns, _pod, _container, stream: Writable) =>
        new Promise<AbortController>((resolve) => {
          source = pipeAbortableWebSource(stream, controller)
          resolveController = resolve
        })
    )

    const starting = startLogStream(sender, SUB_ID, 'cluster-1', REF, {})
    await vi.waitFor(() => expect(mocks.log).toHaveBeenCalledOnce())

    stopLogStream(SUB_ID)
    resolveController?.(controller)
    await starting
    await nextTurn()

    expect(controller.signal.aborted).toBe(true)
    expect(source?.listenerCount('error')).toBeGreaterThan(0)
    expect(sender.listenerCount('destroyed')).toBe(0)
    expect(sender.send).not.toHaveBeenCalled()
  })
})
