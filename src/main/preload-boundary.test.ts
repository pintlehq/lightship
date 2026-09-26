import { describe, expect, it, vi } from 'vitest'
import type { LightshipApi } from '../shared/ipc-types'

const electron = vi.hoisted(() => ({
  expose: vi.fn(),
  invoke: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  removeListener: vi.fn()
}))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.expose },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener
  }
}))

describe('preload bridge', () => {
  it('exposes only the typed API and gives log/watch subscriptions UUID IDs', async () => {
    await import('../preload/index')
    expect(electron.expose).toHaveBeenCalledTimes(1)
    expect(electron.expose.mock.calls[0][0]).toBe('api')
    const api = electron.expose.mock.calls[0][1] as LightshipApi

    const ref = { kind: 'pods', namespace: 'work', name: 'api' }
    const stopLogs = api.cluster.streamLogs('missing', ref, {}, vi.fn())
    const stopWatch = api.cluster.watch('missing', 'pods', vi.fn())
    const starts = electron.invoke.mock.calls.filter(([channel]) =>
      ['cluster:startLogs', 'cluster:startWatch'].includes(channel)
    )
    expect(starts).toHaveLength(2)
    expect(starts[0][1]).toMatch(/^logs:[0-9a-f-]{36}$/)
    expect(starts[1][1]).toMatch(/^watch:[0-9a-f-]{36}$/)
    stopLogs()
    stopWatch()
  })
})
