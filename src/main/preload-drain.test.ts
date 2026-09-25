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

import { createDrainOperation } from '../preload/ipc-helpers'

beforeEach(() => {
  electron.listeners.clear()
  electron.on.mockClear()
  electron.removeListener.mockClear()
  electron.invoke.mockReset()
})

describe('preload drain subscription', () => {
  it('subscribes before starting, queues early cancellation, and cleans up', async () => {
    let finish: (value: unknown) => void = () => undefined
    electron.invoke.mockImplementation((channel: string) =>
      channel === 'cluster:drain'
        ? new Promise((resolve) => {
            finish = resolve
          })
        : Promise.resolve()
    )
    const progress = vi.fn()
    const handle = createDrainOperation('cluster', 'node-a', progress)
    expect(electron.on).toHaveBeenCalledBefore(electron.invoke)
    const [, subId] = electron.invoke.mock.calls[0]
    expect(subId).toMatch(/^drain:/)

    handle.cancel()
    expect(electron.invoke).toHaveBeenCalledTimes(1)
    electron.listeners.get(`cluster:drain:${subId}`)?.({}, { type: 'started' })
    expect(electron.invoke).toHaveBeenCalledWith('cluster:cancelDrain', subId)
    electron.listeners.get(`cluster:drain:${subId}`)?.(
      {},
      {
        type: 'progress',
        progress: { node: 'node-a', phase: 'waiting', message: 'Waiting', pods: [] }
      }
    )
    expect(progress).toHaveBeenCalledOnce()
    finish({ status: 'cancelled' })
    await handle.result
    expect(electron.listeners.has(`cluster:drain:${subId}`)).toBe(false)
  })

  it('removes the listener after a failed start', async () => {
    electron.invoke.mockRejectedValue(new Error('already active'))
    const handle = createDrainOperation('cluster', 'node-a', vi.fn())
    await expect(handle.result).rejects.toThrow('already active')
    expect(electron.listeners.size).toBe(0)
  })

  it('handles a rejected cancellation request without an unhandled rejection', async () => {
    let finish: (value: unknown) => void = () => undefined
    electron.invoke.mockImplementation((channel: string) =>
      channel === 'cluster:drain'
        ? new Promise((resolve) => {
            finish = resolve
          })
        : Promise.reject(new Error('IPC unavailable'))
    )
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const handle = createDrainOperation('cluster', 'node-a', vi.fn())
    const [, subId] = electron.invoke.mock.calls[0]
    electron.listeners.get(`cluster:drain:${subId}`)?.({}, { type: 'started' })
    handle.cancel()
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith('Failed to cancel drain', expect.any(Error))
    )
    finish({ status: 'completed' })
    await handle.result
    error.mockRestore()
  })
})
