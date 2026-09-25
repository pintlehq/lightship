import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  activity: vi.fn()
}))
vi.mock('../lib/ipc', () => ({
  hasBackend: () => true,
  clusterApi: { startPortForward: mocks.start }
}))
vi.mock('../lib/record-activity', () => ({ recordActivity: mocks.activity }))
vi.mock('@renderer/ui/components/toaster', () => ({
  toast: { success: mocks.success, error: mocks.error, info: vi.fn() }
}))

import { usePortForwardsStore } from './port-forwards-store'

const input = {
  clusterId: 'cluster',
  ref: { kind: 'services', namespace: 'work', name: 'api' },
  name: 'api',
  remotePort: 8080,
  localPort: 0
}

beforeEach(() => {
  usePortForwardsStore.setState({ sessions: [] })
  mocks.start.mockReset()
  mocks.stop.mockReset()
  mocks.success.mockReset()
  mocks.error.mockReset()
  mocks.activity.mockReset()
})

describe('port-forward stop lifecycle', () => {
  it('keeps failed stops visible for retry and ignores late running events', async () => {
    let onEvent: (event: { type: string; localPort?: number }) => void = () => undefined
    mocks.start.mockImplementation((_cluster, _ref, _opts, callback) => {
      onEvent = callback
      return { stop: mocks.stop }
    })
    mocks.stop.mockRejectedValueOnce(new Error('IPC unavailable')).mockResolvedValueOnce(undefined)
    const id = usePortForwardsStore.getState().start(input)
    onEvent({ type: 'running', localPort: 43821 })
    expect(usePortForwardsStore.getState().sessions[0].status).toBe('running')
    usePortForwardsStore.getState().stop(id)
    expect(usePortForwardsStore.getState().sessions[0].status).toBe('stopping')
    onEvent({ type: 'running', localPort: 43822 })
    expect(mocks.success).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(usePortForwardsStore.getState().sessions[0].status).toBe('error'))
    expect(usePortForwardsStore.getState().sessions[0].error).toBe('IPC unavailable')
    expect(mocks.activity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'port-forward-stop', outcome: 'error' })
    )
    usePortForwardsStore.getState().stop(id)
    await vi.waitFor(() => expect(usePortForwardsStore.getState().sessions).toHaveLength(0))
    expect(mocks.stop).toHaveBeenCalledTimes(2)
  })

  it('cancels a still-starting forward without a false success record', async () => {
    mocks.start.mockReturnValue({ stop: mocks.stop })
    mocks.stop.mockResolvedValue(undefined)
    const id = usePortForwardsStore.getState().start(input)
    usePortForwardsStore.getState().stop(id)
    await vi.waitFor(() => expect(usePortForwardsStore.getState().sessions).toHaveLength(0))
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.activity).not.toHaveBeenCalled()
  })

  it('reports a synchronous start failure without leaving a handle', () => {
    mocks.start.mockImplementation(() => {
      throw new Error('backend unavailable')
    })
    usePortForwardsStore.getState().start(input)
    expect(usePortForwardsStore.getState().sessions[0].status).toBe('error')
    expect(mocks.error).toHaveBeenCalledWith('Port-forward failed: api', 'backend unavailable')
  })
})
