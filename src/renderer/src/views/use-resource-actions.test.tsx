import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteResource: vi.fn(),
  rolloutRestart: vi.fn(),
  recordActivity: vi.fn(),
  success: vi.fn(),
  error: vi.fn()
}))

vi.mock('../lib/ipc', () => ({
  clusterApi: { deleteResource: mocks.deleteResource, rolloutRestart: mocks.rolloutRestart }
}))
vi.mock('../lib/record-activity', () => ({ recordActivity: mocks.recordActivity }))
vi.mock('@renderer/ui/components/toaster', () => ({
  toast: { success: mocks.success, error: mocks.error, info: vi.fn() }
}))

import { qk } from '../queries/keys'
import { useResourceActions } from './use-resource-actions'

const first = { uid: '1', namespace: 'web', name: 'api', age: '1d', columns: {} }
const second = { uid: '2', namespace: 'web', name: 'worker', age: '1d', columns: {} }
const firstRef = { kind: 'deployments', namespace: 'web', name: 'api' }
const secondRef = { kind: 'deployments', namespace: 'web', name: 'worker' }

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
})

describe('resource action partial refresh', () => {
  it('refreshes the successful delete target even when a later target fails', async () => {
    mocks.deleteResource.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'))
    const qc = new QueryClient()
    qc.setQueryData(qk.yaml('cluster-a', firstRef), 'old')
    qc.setQueryData(qk.yaml('cluster-a', secondRef), 'old')
    qc.setQueryData(qk.resource('cluster-a', 'deployments'), [])
    const { result } = renderHook(
      () =>
        useResourceActions({
          clusterId: 'cluster-a',
          resourceId: 'deployments',
          label: 'Deployments',
          onSelectionActionComplete: vi.fn()
        }),
      { wrapper: wrapper(qc) }
    )
    act(() => result.current.startAction('delete', [first, second]))
    await act(async () => result.current.runAction())

    expect(
      qc.getQueryCache().find({ queryKey: qk.yaml('cluster-a', firstRef) })?.state.isInvalidated
    ).toBe(true)
    expect(
      qc.getQueryCache().find({ queryKey: qk.yaml('cluster-a', secondRef) })?.state.isInvalidated
    ).toBe(false)
    expect(mocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'error', count: 2, message: '1 ok, 1 failed' })
    )
  })
})
