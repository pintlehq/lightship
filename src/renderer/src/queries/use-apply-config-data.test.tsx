import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  record: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn()
}))

vi.mock('../data/fetchers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/fetchers')>()),
  applyConfigData: mocks.apply
}))
vi.mock('../lib/record-activity', () => ({ recordActivity: mocks.record }))
vi.mock('@renderer/ui/components/toaster', () => ({
  toast: { success: mocks.success, error: mocks.error, info: mocks.info }
}))

import { qk } from './keys'
import { useApplyConfigData } from './use-lightship-data'

const ref = { kind: 'secrets', namespace: 'web', name: 'credentials' }
const update = { resourceVersion: '10', data: { TOKEN: 'draft-value' } }
const current = {
  secret: true,
  data: { TOKEN: 'current-value' },
  binaryKeys: [],
  resourceVersion: '11'
}

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
})

describe('useApplyConfigData outcomes', () => {
  it('records a conflict as failure without success invalidation or secret values', async () => {
    mocks.apply.mockResolvedValue({ status: 'conflict', current })
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useApplyConfigData('cluster-a', ref), {
      wrapper: wrapper(qc)
    })

    await act(async () => {
      await result.current.mutateAsync(update)
    })

    expect(invalidate).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'cluster-a',
        kind: 'secrets',
        name: 'credentials',
        outcome: 'error'
      })
    )
    expect(JSON.stringify(mocks.record.mock.calls)).not.toContain('current-value')
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('draft-value')
  })

  it('updates the snapshot, records success, and invalidates affected queries after save', async () => {
    mocks.apply.mockResolvedValue({ status: 'saved', current })
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useApplyConfigData('cluster-a', ref), {
      wrapper: wrapper(qc)
    })

    await act(async () => {
      await result.current.mutateAsync(update)
    })

    expect(qc.getQueryData(qk.configData('cluster-a', ref))).toEqual(current)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.configData('cluster-a', ref) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.yaml('cluster-a', ref) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.resource('cluster-a', 'secrets') })
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }))
  })

  it('does not claim a mutation for unchanged data', async () => {
    mocks.apply.mockResolvedValue({ status: 'unchanged', current })
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useApplyConfigData('cluster-a', ref), {
      wrapper: wrapper(qc)
    })
    await act(async () => {
      await result.current.mutateAsync(update)
    })
    expect(invalidate).not.toHaveBeenCalled()
    expect(mocks.record).not.toHaveBeenCalled()
    expect(mocks.info).toHaveBeenCalled()
  })

  it('redacts Secret request errors before toasting or recording them', async () => {
    mocks.apply.mockRejectedValue(new Error('server echoed draft-value'))
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const { result } = renderHook(() => useApplyConfigData('cluster-a', ref), {
      wrapper: wrapper(qc)
    })
    act(() => result.current.mutate(update))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('draft-value')
    expect(JSON.stringify(mocks.record.mock.calls)).not.toContain('draft-value')
  })
})
