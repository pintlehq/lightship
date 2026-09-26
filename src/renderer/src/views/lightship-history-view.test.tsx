import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  list: vi.fn(),
  clear: vi.fn(),
  success: vi.fn(),
  error: vi.fn()
}))

vi.mock('../lib/ipc', () => ({
  hasBackend: () => true,
  activityApi: { record: mocks.record, list: mocks.list, clear: mocks.clear }
}))
vi.mock('@renderer/ui/components/toaster', () => ({
  toast: { success: mocks.success, error: mocks.error, info: vi.fn() }
}))

import { useActivityStore } from '../stores/activity-store'
import { LightshipHistoryView } from './lightship-history-view'

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.list.mockResolvedValue([])
  useActivityStore.setState({ records: [], pending: [], hydrated: false })
})

describe('LightshipHistoryView unsaved activity', () => {
  it('shows a safe retry that records history without repeating the operation', async () => {
    const input = {
      clusterId: 'cluster-a',
      action: 'apply-config' as const,
      kind: 'secrets',
      name: 'credentials',
      outcome: 'success' as const,
      count: 1,
      message: 'sensitive-token'
    }
    mocks.record.mockResolvedValue({
      ...input,
      id: 'activity-1',
      ts: Date.now(),
      clusterName: 'Production'
    })
    useActivityStore.getState().enqueueFailed(input)
    render(<LightshipHistoryView />)
    expect(screen.getByText('Unsaved activity')).toBeInTheDocument()
    expect(screen.queryByText('sensitive-token')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(useActivityStore.getState().pending).toEqual([]))
    expect(mocks.record).toHaveBeenCalledOnce()
  })

  it('allows discarding a failed record without a write', async () => {
    useActivityStore.getState().enqueueFailed({
      clusterId: 'cluster-a',
      action: 'delete',
      kind: 'pods',
      name: 'old',
      outcome: 'error',
      count: 1
    })
    render(<LightshipHistoryView />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.queryByText('Unsaved activity')).not.toBeInTheDocument()
    expect(mocks.record).not.toHaveBeenCalled()
  })
})
