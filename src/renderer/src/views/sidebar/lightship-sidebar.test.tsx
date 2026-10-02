import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import type { ClusterMeta, TestResult } from '../../../../shared/ipc-types'
import { LightshipSidebar } from './lightship-sidebar'

const cluster: ClusterMeta = {
  id: 'getlinks',
  name: 'GetLinks',
  context: 'getlinks',
  server: 'https://eks.example.test'
}

const secondCluster: ClusterMeta = { ...cluster, id: 'staging', name: 'Staging' }

const mocks = vi.hoisted(() => ({
  test: vi.fn(),
  useClusters: vi.fn<() => { data?: ClusterMeta[] }>(),
  toastError: vi.fn()
}))

vi.mock('../../lib/ipc', () => ({
  clustersApi: { test: mocks.test },
  clusterApi: {},
  hasBackend: () => true
}))
vi.mock('../../queries/clusters', () => ({
  useClusters: mocks.useClusters,
  useRemoveCluster: () => ({ isPending: false, mutate: vi.fn() })
}))
vi.mock('@renderer/ui/components/toaster', () => ({
  toast: { error: mocks.toastError, success: vi.fn() }
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function renderSidebar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onSelect = vi.fn()
  const view = () => (
    <QueryClientProvider client={qc}>
      <LightshipSidebar
        active=""
        activeClusterId={null}
        onSelect={onSelect}
        onOpenCrdKind={vi.fn()}
        onAddCluster={vi.fn()}
        onManageClusters={vi.fn()}
        onNewTerminal={vi.fn()}
      />
    </QueryClientProvider>
  )
  const result = render(view())
  return {
    onSelect,
    unmount: result.unmount,
    updateClusters: (clusters: ClusterMeta[]) => {
      mocks.useClusters.mockReturnValue({ data: clusters })
      result.rerender(view())
    }
  }
}

beforeEach(() => {
  mocks.test.mockReset()
  mocks.useClusters.mockReset().mockReturnValue({ data: [cluster] })
  mocks.toastError.mockReset()
})

it.each([false, true])('starts with all clusters collapsed (delayed load: %s)', (delayed) => {
  mocks.useClusters.mockReturnValue({ data: delayed ? undefined : [cluster, secondCluster] })
  const { onSelect, updateClusters } = renderSidebar()

  if (delayed) updateClusters([cluster, secondCluster])

  expect(screen.getByText('GetLinks')).toBeInTheDocument()
  expect(screen.getByText('Staging')).toBeInTheDocument()
  expect(screen.queryByText('Overview')).not.toBeInTheDocument()
  expect(screen.queryByText('Workloads')).not.toBeInTheDocument()
  expect(mocks.test).not.toHaveBeenCalled()
  expect(onSelect).not.toHaveBeenCalled()
})

it('preserves independent folds when clusters refresh or are added', async () => {
  const user = userEvent.setup()
  const { onSelect, updateClusters } = renderSidebar()
  const toggle = (name: string) => within(screen.getByText(name).parentElement!).getByRole('button')

  await user.click(toggle('GetLinks'))
  expect(screen.getByText('Pods')).toBeInTheDocument()

  updateClusters([{ ...cluster }, secondCluster])
  expect(screen.getAllByText('Overview')).toHaveLength(1)
  await user.click(screen.getByText('Overview'))
  expect(onSelect).toHaveBeenLastCalledWith('getlinks', 'overview', 'Overview')

  await user.click(toggle('Staging'))
  expect(screen.getAllByText('Pods')).toHaveLength(2)
  await user.click(toggle('GetLinks'))
  updateClusters([{ ...secondCluster }, { ...cluster }])
  expect(screen.getAllByText('Overview')).toHaveLength(1)
  await user.click(screen.getByText('Overview'))
  expect(onSelect).toHaveBeenLastCalledWith('staging', 'overview', 'Overview')

  await user.click(toggle('Staging'))
  updateClusters([{ ...cluster }, { ...secondCluster }])
  expect(screen.queryByText('Overview')).not.toBeInTheDocument()
  expect(mocks.test).not.toHaveBeenCalled()
})

it('starts collapsed again when the sidebar remounts', async () => {
  const user = userEvent.setup()
  const { unmount } = renderSidebar()
  const header = screen.getByText('GetLinks').parentElement!
  await user.click(within(header).getByRole('button'))
  expect(screen.getByText('Overview')).toBeInTheDocument()

  unmount()
  renderSidebar()
  expect(screen.queryByText('Overview')).not.toBeInTheDocument()
  expect(mocks.test).not.toHaveBeenCalled()
})

it('expands and checks a cluster without opening a view, then reuses success', async () => {
  const user = userEvent.setup()
  const check = deferred<TestResult>()
  mocks.test.mockReturnValue(check.promise)
  const { onSelect } = renderSidebar()

  expect(screen.queryByText('Overview')).not.toBeInTheDocument()

  await user.click(screen.getByText('GetLinks'))
  expect(screen.getByText('Overview')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByLabelText('GetLinks: connecting')).toBeInTheDocument())
  expect(onSelect).not.toHaveBeenCalled()

  check.resolve({ ok: true, version: 'v1' })
  await waitFor(() => expect(screen.getByLabelText('GetLinks: connected')).toBeInTheDocument())
  await user.click(screen.getByText('GetLinks'))
  expect(mocks.test).toHaveBeenCalledTimes(1)
  expect(onSelect).not.toHaveBeenCalled()

  await user.click(screen.getByText('Overview'))
  expect(onSelect).toHaveBeenCalledWith('getlinks', 'overview', 'Overview')
})

it('rechecks failures from the name and Retry without opening a view', async () => {
  const user = userEvent.setup()
  const nameRetry = deferred<TestResult>()
  const retry = deferred<TestResult>()
  mocks.test
    .mockResolvedValueOnce({ ok: false, error: 'AWS token expired' })
    .mockReturnValueOnce(nameRetry.promise)
    .mockReturnValueOnce(retry.promise)
  const { onSelect } = renderSidebar()

  await user.click(screen.getByText('GetLinks'))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('AWS token expired'))
  expect(onSelect).not.toHaveBeenCalled()

  await user.click(screen.getByText('GetLinks'))
  await waitFor(() => expect(screen.getByLabelText('GetLinks: connecting')).toBeInTheDocument())
  expect(onSelect).not.toHaveBeenCalled()

  nameRetry.resolve({ ok: false, error: 'AWS token expired' })
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('AWS token expired'))

  await user.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.getByLabelText('GetLinks: connecting')).toBeInTheDocument())
  expect(onSelect).not.toHaveBeenCalled()

  retry.resolve({ ok: true })
  await waitFor(() => expect(screen.getByLabelText('GetLinks: connected')).toBeInTheDocument())
  expect(mocks.test).toHaveBeenCalledTimes(3)
  expect(onSelect).not.toHaveBeenCalled()
})
