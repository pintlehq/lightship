import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Pod } from '../../../shared/ipc-types'
import { qk } from '../queries/keys'

const pods: Pod[] = ['api', 'worker'].map((name) => ({
  name,
  ns: 'web',
  status: 'Running',
  ready: '1/1',
  restarts: 0,
  cpu: '1m',
  mem: '1Mi',
  node: 'node-a',
  age: '1d',
  ip: '10.0.0.1',
  containers: [{ name, ready: true, state: 'running' }]
}))

const mocks = vi.hoisted(() => ({
  deleteResource: vi.fn(),
  recordActivity: vi.fn(),
  error: vi.fn(),
  success: vi.fn()
}))

vi.mock('../queries/use-lightship-data', () => ({
  usePods: () => ({ data: pods, isLoading: false, isError: false, error: null }),
  useNamespaces: () => ({ data: [{ name: 'web' }] }),
  useCreateFromYaml: () => ({ mutateAsync: vi.fn(), isPending: false })
}))
vi.mock('../lib/ipc', () => ({ clusterApi: { deleteResource: mocks.deleteResource } }))
vi.mock('../lib/record-activity', () => ({ recordActivity: mocks.recordActivity }))
vi.mock('@renderer/ui/components/toaster', () => ({
  toast: { success: mocks.success, error: mocks.error, info: vi.fn() }
}))
vi.mock('@renderer/ui/components/data-table', () => ({
  DataTable: ({
    data,
    rowSelection,
    onRowSelectionChange
  }: {
    data: Pod[]
    rowSelection: Record<string, boolean>
    onRowSelectionChange: (next: Record<string, boolean>) => void
  }) => (
    <div>
      {data.map((pod) => {
        const id = `${pod.ns}/${pod.name}`
        return (
          <label key={id}>
            <input
              type="checkbox"
              checked={!!rowSelection[id]}
              onChange={(event) =>
                onRowSelectionChange({ ...rowSelection, [id]: event.currentTarget.checked })
              }
            />
            {pod.name}
          </label>
        )
      })}
    </div>
  )
}))

import { PodsView } from './pods-view'

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
})

describe('PodsView partial deletion', () => {
  it('refreshes a deleted pod when a later delete fails', async () => {
    mocks.deleteResource.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'))
    const qc = new QueryClient()
    const first = { kind: 'pods', namespace: 'web', name: 'api' }
    const second = { kind: 'pods', namespace: 'web', name: 'worker' }
    qc.setQueryData(qk.yaml('cluster-a', first), 'old')
    qc.setQueryData(qk.yaml('cluster-a', second), 'old')
    qc.setQueryData(qk.pods('cluster-b'), [])
    render(
      <QueryClientProvider client={qc}>
        <PodsView
          clusterId="cluster-a"
          tabId="tab-a"
          onOpenPod={vi.fn()}
          onOpenLogs={vi.fn()}
          onExec={vi.fn()}
        />
      </QueryClientProvider>
    )
    for (const checkbox of screen.getAllByRole('checkbox').slice(0, 2)) fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mocks.deleteResource).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(
        qc.getQueryCache().find({ queryKey: qk.yaml('cluster-a', first) })?.state.isInvalidated
      ).toBe(true)
    )
    expect(
      qc.getQueryCache().find({ queryKey: qk.yaml('cluster-a', second) })?.state.isInvalidated
    ).toBe(false)
    expect(qc.getQueryCache().find({ queryKey: qk.pods('cluster-b') })?.state.isInvalidated).toBe(
      false
    )
    expect(mocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'error', count: 2, message: '1 deleted, 1 not deleted' })
    )
  })
})
