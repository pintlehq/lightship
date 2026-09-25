import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const listeners = new Map<string, (_event: unknown, value: unknown) => void>()
  return {
    listeners,
    on: vi.fn((channel: string, listener: (_event: unknown, value: unknown) => void) => {
      listeners.set(channel, listener)
    }),
    removeListener: vi.fn((channel: string) => {
      listeners.delete(channel)
    }),
    invoke: vi.fn()
  }
})
vi.mock('electron', () => ({ ipcRenderer: electron }))

import { createManagedSubscription, createSubscription } from '../preload/ipc-helpers'

beforeEach(() => {
  electron.listeners.clear()
  electron.invoke.mockReset()
  electron.on.mockClear()
  electron.removeListener.mockClear()
})

const open = (onEvent = vi.fn()) =>
  createManagedSubscription<{ type: 'error'; message: string }>({
    prefix: 'pty',
    eventPrefix: 'cluster:pty',
    startChannel: 'start',
    stopChannel: 'stop',
    startArgs: ['cluster'],
    onEvent,
    errorEvent: (message) => ({ type: 'error', message })
  })

describe('managed preload subscriptions', () => {
  it('subscribes before start and queues an immediate stop until registration ack', async () => {
    let acknowledge: () => void = () => undefined
    electron.invoke.mockImplementation((channel: string) =>
      channel === 'start'
        ? new Promise<void>((resolve) => {
            acknowledge = resolve
          })
        : Promise.resolve()
    )
    const onEvent = vi.fn()
    const handle = open(onEvent)
    expect(electron.on).toHaveBeenCalledBefore(electron.invoke)
    expect(handle.subId).toMatch(/^pty:[0-9a-f-]{36}$/)
    const stopped = handle.stop()
    expect(electron.invoke).toHaveBeenCalledTimes(1)
    acknowledge()
    await stopped
    expect(electron.invoke).toHaveBeenCalledWith('stop', handle.subId)
    expect(electron.listeners.size).toBe(0)
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('delivers a rejected start as an error event without a stop call', async () => {
    electron.invoke.mockRejectedValueOnce(new Error('registration denied'))
    const onEvent = vi.fn()
    const handle = open(onEvent)
    await vi.waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith({ type: 'error', message: 'registration denied' })
    )
    await handle.stop()
    expect(electron.invoke).toHaveBeenCalledTimes(1)
  })

  it('returns rejected stops and allows the owner to retry', async () => {
    electron.invoke
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('stop failed'))
      .mockResolvedValueOnce(undefined)
    const handle = open()
    await expect(handle.stop()).rejects.toThrow('stop failed')
    await expect(handle.stop()).resolves.toBeUndefined()
    expect(electron.invoke).toHaveBeenCalledTimes(3)
  })

  it('observes rejected legacy start and stop invocations', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    electron.invoke.mockRejectedValue(new Error('IPC unavailable'))
    const unsubscribe = createSubscription({
      subId: 'logs:1',
      eventPrefix: 'cluster:logs',
      startChannel: 'startLogs',
      stopChannel: 'stopLogs',
      startArgs: [],
      onEvent: vi.fn()
    })
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith('startLogs failed', expect.any(Error))
    )
    unsubscribe()
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('stopLogs failed', expect.any(Error)))
    error.mockRestore()
  })
})
