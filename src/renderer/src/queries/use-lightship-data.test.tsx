import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClusterMeta } from '../../../shared/ipc-types'
import { qk } from './keys'
import { useReorderClusters } from './use-lightship-data'

const alpha: ClusterMeta = { id: 'alpha', name: 'alpha', context: 'alpha', server: 'https://a' }
const beta: ClusterMeta = { id: 'beta', name: 'beta', context: 'beta', server: 'https://b' }

const mocks = vi.hoisted(() => ({
  reorder: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('../lib/ipc', () => ({
  clustersApi: { reorder: mocks.reorder },
  clusterApi: {},
  hasBackend: () => false
}))

vi.mock('@renderer/ui/components/toaster', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError }
}))

function createWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  mocks.reorder.mockReset()
  mocks.toastSuccess.mockReset()
  mocks.toastError.mockReset()
})

describe('useReorderClusters', () => {
  it('calls the cluster reorder API and updates the shared clusters cache', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const ordered = [beta, alpha]
    mocks.reorder.mockResolvedValue(ordered)
    qc.setQueryData(qk.clusters(), [alpha, beta])

    const { result } = renderHook(() => useReorderClusters(), { wrapper: createWrapper(qc) })

    await act(async () => {
      await result.current.mutateAsync(['beta', 'alpha'])
    })

    expect(mocks.reorder).toHaveBeenCalledWith(['beta', 'alpha'])
    expect(qc.getQueryData(qk.clusters())).toEqual(ordered)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Cluster order updated')
  })
})
