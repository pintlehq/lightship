import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TestResult } from '../../../shared/ipc-types'
import { qk } from './keys'
import { checkClusterConnection, useClusterNavigation } from './cluster-connection'

const mocks = vi.hoisted(() => ({
  test: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('../lib/ipc', () => ({
  clustersApi: { test: mocks.test },
  hasBackend: () => true
}))
vi.mock('@renderer/ui/components/toaster', () => ({
  toast: { error: mocks.toastError }
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, ...renderHook(() => useClusterNavigation(), { wrapper }) }
}

beforeEach(() => {
  mocks.test.mockReset()
  mocks.toastError.mockReset()
})

describe('cluster navigation readiness', () => {
  it('waits for a first check and reuses a successful result', async () => {
    const check = deferred<TestResult>()
    mocks.test.mockReturnValue(check.promise)
    const { result } = setup()
    const open = vi.fn()

    act(() => result.current('c1', 'Cluster one', open))
    expect(mocks.test).toHaveBeenCalledExactlyOnceWith('c1')
    expect(open).not.toHaveBeenCalled()

    await act(async () => check.resolve({ ok: true, version: 'v1' }))
    await waitFor(() => expect(open).toHaveBeenCalledOnce())

    act(() => result.current('c1', 'Cluster one', open))
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    expect(mocks.test).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed destination closed and retries on the next click', async () => {
    mocks.test
      .mockResolvedValueOnce({ ok: false, error: 'token expired' })
      .mockResolvedValueOnce({ ok: true, version: 'v1' })
    const { result, qc } = setup()
    const open = vi.fn()

    act(() => result.current('c1', 'Cluster one', open))
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Could not connect to Cluster one',
        'token expired'
      )
    )
    expect(open).not.toHaveBeenCalled()
    expect(qc.getQueryData(qk.clusterConnection('c1'))).toEqual({
      ok: false,
      error: 'token expired'
    })

    act(() => result.current('c1', 'Cluster one', open))
    await waitFor(() => expect(open).toHaveBeenCalledOnce())
    expect(mocks.test).toHaveBeenCalledTimes(2)
  })

  it('opens only the latest destination after overlapping checks', async () => {
    const first = deferred<TestResult>()
    const second = deferred<TestResult>()
    mocks.test.mockImplementation((id: string) => (id === 'c1' ? first.promise : second.promise))
    const { result } = setup()
    const openFirst = vi.fn()
    const openSecond = vi.fn()

    act(() => {
      result.current('c1', 'Cluster one', openFirst)
      result.current('c2', 'Cluster two', openSecond)
    })
    await act(async () => first.resolve({ ok: true }))
    await act(async () => second.resolve({ ok: true }))
    await waitFor(() => expect(openSecond).toHaveBeenCalledOnce())
    expect(openFirst).not.toHaveBeenCalled()
  })

  it('lets a manual test refresh a previously successful result', async () => {
    mocks.test
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: 'offline' })
    const { qc } = setup()

    expect(await checkClusterConnection(qc, 'c1')).toEqual({ ok: true })
    expect(await checkClusterConnection(qc, 'c1')).toEqual({ ok: false, error: 'offline' })
    expect(mocks.test).toHaveBeenCalledTimes(2)
  })
})
