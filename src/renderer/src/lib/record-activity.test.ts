import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  list: vi.fn(),
  clear: vi.fn(),
  success: vi.fn(),
  error: vi.fn()
}))

vi.mock('./ipc', () => ({
  activityApi: { record: mocks.record, list: mocks.list, clear: mocks.clear }
}))
vi.mock('@renderer/ui/components/toaster', () => ({
  toast: { success: mocks.success, error: mocks.error, info: vi.fn() }
}))

import type { ActivityInput, ActivityRecord } from '../../../shared/ipc-types'
import { queueFailedActivity, recordActivity } from './record-activity'
import { useActivityStore } from '../stores/activity-store'

const input: ActivityInput = {
  clusterId: 'cluster-a',
  action: 'apply-config',
  kind: 'secrets',
  namespace: 'web',
  name: 'credentials',
  outcome: 'success',
  message: 'sensitive-value',
  count: 1
}
const saved: ActivityRecord = {
  ...input,
  id: 'record-1',
  ts: 1,
  clusterName: 'Production'
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  useActivityStore.setState({ records: [], pending: [], hydrated: false })
})

describe('activity recording recovery', () => {
  it('queues a rejected write and reports it without leaking the input or mutation outcome', async () => {
    mocks.record.mockRejectedValueOnce(new Error('disk failure with sensitive-value'))
    recordActivity(input)
    await waitFor(() => expect(useActivityStore.getState().pending).toHaveLength(1))
    expect(useActivityStore.getState().records).toEqual([])
    expect(useActivityStore.getState().pending[0].input).toEqual(input)
    expect(mocks.error).toHaveBeenCalledOnce()
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('sensitive-value')
  })

  it('retries the record exactly once without replaying the Kubernetes operation', async () => {
    let complete: (record: ActivityRecord) => void = () => {}
    mocks.record.mockImplementationOnce(
      () => new Promise<ActivityRecord>((resolve) => (complete = resolve))
    )
    queueFailedActivity(input)
    const id = useActivityStore.getState().pending[0].id
    const first = useActivityStore.getState().retryFailed(id)
    const duplicate = useActivityStore.getState().retryFailed(id)
    expect(mocks.record).toHaveBeenCalledOnce()
    complete(saved)
    await Promise.all([first, duplicate])
    expect(useActivityStore.getState().pending).toEqual([])
    expect(useActivityStore.getState().records).toEqual([saved])
    expect(mocks.success).toHaveBeenCalledOnce()
  })

  it('retains a failed retry for another attempt', async () => {
    mocks.record.mockRejectedValueOnce(new Error('still unavailable'))
    queueFailedActivity(input)
    const id = useActivityStore.getState().pending[0].id
    await useActivityStore.getState().retryFailed(id)
    expect(useActivityStore.getState().pending[0]).toMatchObject({ id, retrying: false })
    expect(mocks.error).toHaveBeenCalledTimes(2)
  })

  it('does not restore an entry cleared while its retry was in flight', async () => {
    let complete: (record: ActivityRecord) => void = () => {}
    mocks.record.mockImplementationOnce(
      () => new Promise<ActivityRecord>((resolve) => (complete = resolve))
    )
    mocks.clear.mockResolvedValueOnce(undefined)
    queueFailedActivity(input)
    const id = useActivityStore.getState().pending[0].id
    const retry = useActivityStore.getState().retryFailed(id)
    await useActivityStore.getState().clear()
    complete(saved)
    await retry
    expect(useActivityStore.getState().pending).toEqual([])
    expect(useActivityStore.getState().records).toEqual([])
  })

  it('handles history reads and clear failures, and clears pending records only after success', async () => {
    mocks.list.mockRejectedValueOnce(new Error('read failed'))
    await useActivityStore.getState().hydrate()
    expect(useActivityStore.getState().hydrated).toBe(false)
    mocks.list.mockRejectedValueOnce(new Error('refresh failed'))
    await useActivityStore.getState().refresh()
    expect(mocks.error).toHaveBeenCalledWith(
      'Activity history unavailable',
      'Could not refresh saved activity.'
    )
    queueFailedActivity(input)
    mocks.clear.mockRejectedValueOnce(new Error('write failed'))
    await useActivityStore.getState().clear()
    expect(useActivityStore.getState().pending).toHaveLength(1)
    mocks.clear.mockResolvedValueOnce(undefined)
    await useActivityStore.getState().clear()
    expect(useActivityStore.getState().pending).toEqual([])
    expect(useActivityStore.getState().records).toEqual([])
  })

  it('does not queue a no-backend record, and can discard a failed record', async () => {
    mocks.record.mockResolvedValueOnce(null)
    recordActivity(input)
    await waitFor(() => expect(mocks.record).toHaveBeenCalledOnce())
    expect(useActivityStore.getState().pending).toEqual([])
    queueFailedActivity(input)
    const id = useActivityStore.getState().pending[0].id
    useActivityStore.getState().discardFailed(id)
    expect(useActivityStore.getState().pending).toEqual([])
  })
})
