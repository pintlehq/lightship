import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  record: vi.fn(),
  success: vi.fn(),
  error: vi.fn()
}))

vi.mock('../data/fetchers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/fetchers')>()),
  applyResourceYaml: mocks.apply
}))
vi.mock('../lib/record-activity', () => ({ recordActivity: mocks.record }))
vi.mock('@renderer/ui/components/toaster', () => ({
  toast: { success: mocks.success, error: mocks.error }
}))

import { qk } from './keys'
import { useApplyYaml } from './use-lightship-data'

const ref = { kind: 'deployments', namespace: 'web', name: 'api' }

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
})

describe('useApplyYaml', () => {
  it('records success and refreshes the selected resource only after successful apply', async () => {
    mocks.apply.mockResolvedValue(undefined)
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useApplyYaml('cluster-a', ref), { wrapper: wrapper(qc) })

    await act(async () => {
      await result.current.mutateAsync('edited YAML')
    })

    expect(mocks.apply).toHaveBeenCalledWith('cluster-a', ref, 'edited YAML')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.yaml('cluster-a', ref) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.resource('cluster-a', 'deployments') })
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'cluster-a',
        kind: 'deployments',
        namespace: 'web',
        name: 'api',
        outcome: 'success'
      })
    )
  })

  it('records failure against the selected resource without success invalidation', async () => {
    mocks.apply.mockRejectedValue(new Error('Manifest metadata.name must match'))
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useApplyYaml('cluster-a', ref), { wrapper: wrapper(qc) })

    act(() => result.current.mutate('edited YAML'))
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(invalidate).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'cluster-a',
        kind: 'deployments',
        namespace: 'web',
        name: 'api',
        outcome: 'error'
      })
    )
  })
})
