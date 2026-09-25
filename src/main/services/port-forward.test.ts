import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  kc: vi.fn(),
  createServer: vi.fn(),
  forward: vi.fn(),
  readService: vi.fn(),
  listPods: vi.fn()
}))
vi.mock('node:net', () => ({ createServer: mocks.createServer }))
vi.mock('./k8s', () => ({
  kcForCluster: mocks.kc,
  loadK8s: async () => ({
    CoreV1Api: class {},
    PortForward: class {
      portForward(...args: unknown[]) {
        return mocks.forward(...args)
      }
    }
  })
}))

import { startPortForward, stopPortForward } from './port-forward'

class Sender extends EventEmitter {
  id: number
  destroyed = false
  send = vi.fn()
  constructor(id: number) {
    super()
    this.id = id
  }
  isDestroyed = (): boolean => this.destroyed
  close(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

class FakeSocket extends EventEmitter {
  destroyed = false
  destroy(): void {
    if (!this.destroyed) {
      this.destroyed = true
      this.emit('close')
    }
  }
}

class FakeServer extends EventEmitter {
  closed = false
  listeningCallback?: () => void
  constructor(readonly onConnection: (socket: FakeSocket) => void) {
    super()
  }
  listen(_port: number, _host: string, callback: () => void): void {
    this.listeningCallback = callback
  }
  address(): { port: number } {
    return { port: 43821 }
  }
  close(): void {
    this.closed = true
    this.emit('close')
  }
  accept(socket: FakeSocket): void {
    this.onConnection(socket)
  }
}

const servers: FakeServer[] = []
const owner = (id = 1): WebContents => new Sender(id) as unknown as WebContents
const ref = { kind: 'pods', namespace: 'work', name: 'api' }
const opts = { remotePort: 8080, localPort: 0 }

beforeEach(() => {
  servers.length = 0
  mocks.createServer.mockReset().mockImplementation((callback) => {
    const server = new FakeServer(callback)
    servers.push(server)
    return server
  })
  mocks.forward.mockReset().mockResolvedValue({ terminate: vi.fn() })
  mocks.readService
    .mockReset()
    .mockResolvedValue({ spec: { selector: { app: 'api' }, ports: [{ port: 8080 }] } })
  mocks.listPods.mockReset().mockResolvedValue({
    items: [
      {
        metadata: { name: 'api-pod' },
        status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] }
      }
    ]
  })
  mocks.kc.mockReset().mockResolvedValue({
    makeApiClient: () => ({
      readNamespacedService: mocks.readService,
      listNamespacedPod: mocks.listPods
    })
  })
})

describe('port-forward session lifecycle', () => {
  it('stops during kubeconfig resolution without creating a listener', async () => {
    let resolveKc: (value: unknown) => void = () => undefined
    mocks.kc.mockReturnValue(
      new Promise((resolve) => {
        resolveKc = resolve
      })
    )
    const sender = owner()
    startPortForward(sender, 'pending', 'cluster', ref, opts)
    stopPortForward(sender, 'pending')
    resolveKc({ makeApiClient: vi.fn() })
    await Promise.resolve()
    expect(servers).toHaveLength(0)
    expect((sender as unknown as Sender).listenerCount('destroyed')).toBe(0)
  })

  it('replaces pending target resolution and ignores its late result', async () => {
    let resolveOld: (value: unknown) => void = () => undefined
    mocks.readService.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve
      })
    )
    const sender = owner()
    startPortForward(
      sender,
      'replace',
      'cluster',
      { kind: 'services', namespace: 'work', name: 'svc' },
      opts
    )
    await vi.waitFor(() => expect(mocks.readService).toHaveBeenCalledOnce())
    startPortForward(sender, 'replace', 'cluster', ref, opts)
    await vi.waitFor(() => expect(servers).toHaveLength(1))
    resolveOld({ spec: { selector: { app: 'old' }, ports: [{ port: 8080 }] } })
    await Promise.resolve()
    expect(servers).toHaveLength(1)
    stopPortForward(sender, 'replace')
    expect(servers[0].closed).toBe(true)
    expect((sender as unknown as Sender).listenerCount('destroyed')).toBe(0)
  })

  it('cancels target resolution when its renderer is destroyed', async () => {
    let resolveService: (value: unknown) => void = () => undefined
    mocks.readService.mockReturnValue(
      new Promise((resolve) => {
        resolveService = resolve
      })
    )
    const client = new Sender(3)
    startPortForward(
      client as unknown as WebContents,
      'destroy-target',
      'cluster',
      { kind: 'services', namespace: 'work', name: 'svc' },
      opts
    )
    await vi.waitFor(() => expect(mocks.readService).toHaveBeenCalledOnce())
    client.close()
    resolveService({ spec: { selector: { app: 'api' }, ports: [{ port: 8080 }] } })
    await Promise.resolve()
    expect(servers).toHaveLength(0)
    expect(client.send).not.toHaveBeenCalled()
    expect(client.listenerCount('destroyed')).toBe(0)
  })

  it('prevents late listening events after sender destruction', async () => {
    const sender = owner() as unknown as Sender
    startPortForward(sender as unknown as WebContents, 'late', 'cluster', ref, opts)
    await vi.waitFor(() => expect(servers).toHaveLength(1))
    sender.close()
    servers[0].listeningCallback?.()
    expect(servers[0].closed).toBe(true)
    expect(sender.send).not.toHaveBeenCalledWith(
      'cluster:pf:late',
      expect.objectContaining({ type: 'running' })
    )
    expect(sender.listenerCount('destroyed')).toBe(0)
  })

  it('destroys accepted sockets and a WebSocket that resolves after stop', async () => {
    let resolveForward: (value: unknown) => void = () => undefined
    mocks.forward.mockReturnValue(
      new Promise((resolve) => {
        resolveForward = resolve
      })
    )
    const sender = owner()
    startPortForward(sender, 'socket', 'cluster', ref, opts)
    await vi.waitFor(() => expect(servers).toHaveLength(1))
    const socket = new FakeSocket()
    servers[0].accept(socket)
    stopPortForward(sender, 'socket')
    const ws = { terminate: vi.fn() }
    resolveForward(ws)
    await vi.waitFor(() => expect(ws.terminate).toHaveBeenCalledOnce())
    expect(socket.destroyed).toBe(true)
    expect(servers[0].closed).toBe(true)
  })

  it('terminates an established WebSocket and reports a bind failure', async () => {
    const sender = owner() as unknown as Sender
    const ws = { terminate: vi.fn() }
    mocks.forward.mockResolvedValue(ws)
    startPortForward(sender as unknown as WebContents, 'active', 'cluster', ref, opts)
    await vi.waitFor(() => expect(servers).toHaveLength(1))
    const socket = new FakeSocket()
    servers[0].accept(socket)
    await vi.waitFor(() => expect(mocks.forward).toHaveBeenCalledOnce())
    await Promise.resolve()
    stopPortForward(sender as unknown as WebContents, 'active')
    expect(socket.destroyed).toBe(true)
    expect(ws.terminate).toHaveBeenCalledOnce()

    startPortForward(sender as unknown as WebContents, 'bind-failure', 'cluster', ref, opts)
    await vi.waitFor(() => expect(servers).toHaveLength(2))
    servers[1].emit('error', new Error('address in use'))
    expect(sender.send).toHaveBeenCalledWith('cluster:pf:bind-failure', {
      type: 'error',
      message: 'address in use'
    })
    expect(servers[1].closed).toBe(true)
    expect(sender.listenerCount('destroyed')).toBe(0)
  })

  it('rejects cross-window replacement and stop, and leaves no listeners after repeat cycles', async () => {
    const sender = owner() as unknown as Sender
    const other = owner(2)
    for (let cycle = 0; cycle < 3; cycle++) {
      startPortForward(sender as unknown as WebContents, 'cycles', 'cluster', ref, opts)
      await vi.waitFor(() => expect(servers).toHaveLength(cycle + 1))
      expect(() => startPortForward(other, 'cycles', 'cluster', ref, opts)).toThrow(
        'another window'
      )
      stopPortForward(other, 'cycles')
      expect(servers[cycle].closed).toBe(false)
      stopPortForward(sender as unknown as WebContents, 'cycles')
      expect(sender.listenerCount('destroyed')).toBe(0)
    }
  })
})
