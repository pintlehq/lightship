import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({
  read: vi.fn(),
  spawn: vi.fn(),
  temp: ''
}))
vi.mock('electron', () => ({ app: { getPath: () => env.temp } }))
vi.mock('node-pty', () => ({ spawn: env.spawn }))
vi.mock('./cluster-store', () => ({ readKubeconfig: env.read }))

import { resizePty, startPty, stopPty, writePty } from './pty'

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

function fakePty() {
  let data: ((text: string) => void) | undefined
  let exit: ((event: { exitCode: number }) => void) | undefined
  const dataDispose = vi.fn()
  const exitDispose = vi.fn()
  return {
    onData: vi.fn((cb: typeof data) => {
      data = cb
      return { dispose: dataDispose }
    }),
    onExit: vi.fn((cb: typeof exit) => {
      exit = cb
      return { dispose: exitDispose }
    }),
    kill: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    emitData: (text: string) => data?.(text),
    emitExit: (exitCode: number) => exit?.({ exitCode }),
    dataDispose,
    exitDispose
  }
}

const opts = { cols: 80, rows: 24 }
const sender = (id = 1): WebContents => new Sender(id) as unknown as WebContents

beforeEach(() => {
  env.temp = mkdtempSync(join(tmpdir(), 'lightship-pty-test-'))
  env.read.mockReset().mockResolvedValue('apiVersion: v1')
  env.spawn.mockReset().mockImplementation(fakePty)
})
afterEach(() => {
  rmSync(env.temp, { recursive: true, force: true })
})
afterAll(() => {
  stopPty(sender(), 'pending')
  stopPty(sender(), 'replace')
  stopPty(sender(), 'live')
})

describe('terminal session lifecycle', () => {
  it('stops during credential lookup without spawning or creating a file', async () => {
    let resolveRead: (value: string) => void = () => undefined
    env.read.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveRead = resolve
      })
    )
    const owner = sender()
    startPty(owner, 'pending', 'cluster', opts)
    expect((owner as unknown as Sender).listenerCount('destroyed')).toBe(1)
    stopPty(owner, 'pending')
    resolveRead('apiVersion: v1')
    await vi.waitFor(() => expect(env.spawn).not.toHaveBeenCalled())
    expect((owner as unknown as Sender).listenerCount('destroyed')).toBe(0)
  })

  it('cancels pending startup when its renderer is destroyed', async () => {
    let resolveRead: (value: string) => void = () => undefined
    env.read.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveRead = resolve
      })
    )
    const client = new Sender(3)
    startPty(client as unknown as WebContents, 'destroyed', 'cluster', opts)
    client.close()
    resolveRead('apiVersion: v1')
    await Promise.resolve()
    expect(env.spawn).not.toHaveBeenCalled()
    expect(client.listenerCount('destroyed')).toBe(0)
    expect(client.send).not.toHaveBeenCalled()
  })

  it('replaces a pending session without letting the old lookup spawn later', async () => {
    let resolveOld: (value: string) => void = () => undefined
    env.read
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveOld = resolve
        })
      )
      .mockResolvedValueOnce('new credentials')
    const owner = sender()
    startPty(owner, 'replace', 'old', opts)
    startPty(owner, 'replace', 'new', opts)
    await vi.waitFor(() => expect(env.spawn).toHaveBeenCalledOnce())
    const credential = env.spawn.mock.calls[0][2].env.KUBECONFIG as string
    expect(existsSync(credential)).toBe(true)
    if (process.platform !== 'win32') expect(statSync(credential).mode & 0o777).toBe(0o600)
    resolveOld('old credentials')
    await Promise.resolve()
    expect(env.spawn).toHaveBeenCalledOnce()
    stopPty(owner, 'replace')
    expect(existsSync(credential)).toBe(false)
    expect((owner as unknown as Sender).listenerCount('destroyed')).toBe(0)
  })

  it('rejects other owners and disposes on natural exit without late output', async () => {
    const owner = sender()
    const other = sender(2)
    startPty(owner, 'live', 'cluster', opts)
    await vi.waitFor(() => expect(env.spawn).toHaveBeenCalledOnce())
    const proc = env.spawn.mock.results[0].value as ReturnType<typeof fakePty>
    const credential = env.spawn.mock.calls[0][2].env.KUBECONFIG as string
    expect(() => startPty(other, 'live', 'cluster', opts)).toThrow('another window')
    writePty(other, 'live', 'ignored')
    resizePty(other, 'live', 100, 30)
    stopPty(other, 'live')
    expect(proc.kill).not.toHaveBeenCalled()
    writePty(owner, 'live', 'hello')
    expect(proc.write).toHaveBeenCalledWith('hello')
    proc.emitData('before exit')
    proc.emitExit(0)
    expect(owner.send).toHaveBeenCalledWith('cluster:pty:live', { type: 'exit', exitCode: 0 })
    expect(existsSync(credential)).toBe(false)
    expect(proc.dataDispose).toHaveBeenCalledOnce()
    expect(proc.exitDispose).toHaveBeenCalledOnce()
    proc.emitData('late')
    expect(owner.send).not.toHaveBeenCalledWith('cluster:pty:live', { type: 'data', data: 'late' })
    expect((owner as unknown as Sender).listenerCount('destroyed')).toBe(0)
  })

  it('reports a spawn failure and removes the temporary credential file', async () => {
    env.spawn.mockImplementation(() => {
      throw new Error('pty unavailable')
    })
    const client = new Sender(4)
    startPty(client as unknown as WebContents, 'failure', 'cluster', opts)
    await vi.waitFor(() =>
      expect(client.send).toHaveBeenCalledWith('cluster:pty:failure', {
        type: 'error',
        message: 'pty unavailable'
      })
    )
    expect(client.listenerCount('destroyed')).toBe(0)
    expect(env.spawn).toHaveBeenCalledOnce()
    const path = env.spawn.mock.calls[0][2]?.env?.KUBECONFIG as string | undefined
    if (path) expect(existsSync(path)).toBe(false)
  })
})
