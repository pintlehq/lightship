import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceRow } from '../../../shared/ipc-types'
import { useUiStore } from '../stores/ui-store'
import { ResourceListView } from './resource-list-view'

const rows: ResourceRow[] = [
  { uid: 'web/api', namespace: 'web', name: 'api', age: '3d', columns: { ready: '1/2' } },
  { uid: 'web/worker', namespace: 'web', name: 'worker', age: '2d', columns: { ready: '2/2' } }
]

const mocks = vi.hoisted(() => ({
  scaleResource: vi.fn(() => Promise.resolve()),
  recordActivity: vi.fn(() => Promise.resolve(null))
}))

vi.mock('../queries/use-lightship-data', () => ({
  useResource: () => ({
    data: rows,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false
  }),
  useNamespaces: () => ({ data: [] }),
  useCreateFromYaml: () => ({ mutateAsync: vi.fn(), isPending: false })
}))

vi.mock('../lib/ipc', () => ({
  clusterApi: {
    scaleResource: mocks.scaleResource,
    deleteResource: vi.fn(),
    rolloutRestart: vi.fn()
  },
  activityApi: { record: mocks.recordActivity },
  hasBackend: () => true
}))

vi.mock('@renderer/ui/components/data-table', () => ({
  DataTable: ({
    data,
    rowSelection,
    onRowSelectionChange
  }: {
    data: ResourceRow[]
    rowSelection: Record<string, boolean>
    onRowSelectionChange: (next: Record<string, boolean>) => void
  }) => (
    <div>
      {data.map((row) => (
        <label key={row.uid}>
          <input
            type="checkbox"
            checked={!!rowSelection[row.uid]}
            onChange={(e) =>
              onRowSelectionChange({ ...rowSelection, [row.uid]: e.currentTarget.checked })
            }
          />
          {row.name}
        </label>
      ))}
    </div>
  )
}))

function renderList(resourceId = 'deployments') {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <ResourceListView
        clusterId="cluster-a"
        resourceId={resourceId}
        label={resourceId === 'daemonsets' ? 'DaemonSets' : 'Deployments'}
        tabId="tab-a"
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mocks.scaleResource.mockClear()
  mocks.recordActivity.mockClear()
  useUiStore.setState({ readOnly: false })
})

describe('ResourceListView bulk scale', () => {
  it('shows Scale for selected scalable workloads and clears selection after completion', async () => {
    const user = userEvent.setup()
    renderList('deployments')

    await user.click(screen.getByLabelText('api'))
    await user.click(screen.getByLabelText('worker'))
    await user.click(screen.getByRole('button', { name: 'Scale' }))
    await user.clear(screen.getByLabelText('Replicas'))
    await user.type(screen.getByLabelText('Replicas'), '4')
    const scaleButtons = screen.getAllByRole('button', { name: 'Scale' })
    await user.click(scaleButtons[scaleButtons.length - 1]!)

    await waitFor(() => expect(mocks.scaleResource).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument()
  })

  it('does not show Scale for selected non-scalable workloads', async () => {
    const user = userEvent.setup()
    renderList('daemonsets')

    await user.click(screen.getByLabelText('api'))

    expect(screen.queryByRole('button', { name: 'Scale' })).not.toBeInTheDocument()
  })

  it('disables bulk Scale in read-only mode', async () => {
    const user = userEvent.setup()
    useUiStore.setState({ readOnly: true })
    renderList('deployments')

    await user.click(screen.getByLabelText('api'))

    expect(screen.getByRole('button', { name: 'Scale' })).toBeDisabled()
  })
})
