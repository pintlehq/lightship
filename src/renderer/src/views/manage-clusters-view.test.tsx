import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClusterMeta } from '../../../shared/ipc-types'
import { qk } from '../queries/keys'
import { ManageClustersView } from './manage-clusters-view'

const alpha: ClusterMeta = { id: 'alpha', name: 'alpha', context: 'alpha', server: 'https://a' }
const beta: ClusterMeta = { id: 'beta', name: 'beta', context: 'beta', server: 'https://b' }
const gamma: ClusterMeta = { id: 'gamma', name: 'gamma', context: 'gamma', server: 'https://c' }
const clusters = [alpha, beta, gamma]

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  reorder: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  test: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('../lib/ipc', () => ({
  clustersApi: {
    list: mocks.list,
    reorder: mocks.reorder,
    remove: mocks.remove,
    rename: mocks.rename,
    test: mocks.test
  },
  clusterApi: {},
  hasBackend: () => false
}))

vi.mock('@renderer/ui/components/toaster', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError }
}))

function renderManageClusters() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  render(<ManageClustersView onAdd={vi.fn()} />, { wrapper: Wrapper })
  return qc
}

beforeEach(() => {
  mocks.list.mockReset()
  mocks.reorder.mockReset()
  mocks.remove.mockReset()
  mocks.rename.mockReset()
  mocks.test.mockReset()
  mocks.toastSuccess.mockReset()
  mocks.toastError.mockReset()
  mocks.list.mockResolvedValue(clusters)
  mocks.reorder.mockImplementation(async (ids: string[]) =>
    ids.map((id) => clusters.find((cluster) => cluster.id === id)!)
  )
})

describe('ManageClustersView cluster order controls', () => {
  it('disables moving the first cluster up and the last cluster down', async () => {
    renderManageClusters()

    await screen.findByRole('button', { name: 'alpha' })

    expect(screen.getByRole('button', { name: 'Move alpha up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move alpha down' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Move gamma up' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Move gamma down' })).toBeDisabled()
  })

  it('submits the swapped id list and renders the returned cluster order', async () => {
    const user = userEvent.setup()
    renderManageClusters()

    await screen.findByRole('button', { name: 'alpha' })
    await user.click(screen.getByRole('button', { name: 'Move alpha down' }))

    await waitFor(() => expect(mocks.reorder).toHaveBeenCalledWith(['beta', 'alpha', 'gamma']))
    await waitFor(() => {
      const rows = screen.getAllByRole('row').slice(1)
      expect(within(rows[0]!).getByRole('button', { name: 'beta' })).toBeInTheDocument()
      expect(within(rows[1]!).getByRole('button', { name: 'alpha' })).toBeInTheDocument()
      expect(within(rows[2]!).getByRole('button', { name: 'gamma' })).toBeInTheDocument()
    })
  })
})

describe('ManageClustersView connection status', () => {
  it('shows a sidebar check and replaces it after a manual test', async () => {
    const user = userEvent.setup()
    const qc = renderManageClusters()
    await screen.findByRole('button', { name: 'beta' })

    qc.setQueryData(qk.clusterConnection('beta'), { ok: true, version: 'v1' })
    const betaRow = screen.getByRole('button', { name: 'beta' }).closest('tr')!
    await waitFor(() => {
      expect(within(betaRow).getByText('connected')).toBeInTheDocument()
      expect(within(betaRow).getByText('v1')).toBeInTheDocument()
    })

    mocks.test.mockResolvedValue({ ok: false, error: 'AWS token expired' })
    await user.click(within(betaRow).getByRole('button', { name: 'Test connection' }))
    await waitFor(() => expect(within(betaRow).getByText('AWS token expired')).toBeInTheDocument())
    expect(qc.getQueryData(qk.clusterConnection('beta'))).toEqual({
      ok: false,
      error: 'AWS token expired'
    })
  })
})
