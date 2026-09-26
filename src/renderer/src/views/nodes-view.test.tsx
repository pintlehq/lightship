import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DrainResult, NodeRow } from '../../../shared/ipc-types'
import { qk } from '../queries/keys'
import { useActivityStore } from '../stores/activity-store'

const nodes: NodeRow[] = ['node-a', 'node-b'].map((name) => ({
  name,
  roles: ['worker'],
  status: 'Ready',
  cpuPct: 10,
  cpu: '2',
  memPct: 10,
  mem: '4Gi',
  pods: 1,
  maxPods: 20,
  ver: '1.30',
  zone: 'zone-a',
  type: 'standard',
  age: '1d',
  ip: '10.0.0.1',
  cordoned: false
}))

const mocks = vi.hoisted(() => ({
  drain: vi.fn(),
  cordon: vi.fn(),
  uncordon: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  recordActivity: vi.fn(),
  queueFailedActivity: vi.fn()
}))

vi.mock('../queries/use-lightship-data', () => ({
  useNodes: () => ({ data: nodes, isLoading: false, isError: false, error: null }),
  useClusters: () => ({ data: [{ id: 'cluster-a', name: 'Production' }] })
}))
vi.mock('../lib/ipc', () => ({
  clusterApi: { drain: mocks.drain, cordon: mocks.cordon, uncordon: mocks.uncordon },
  activityApi: { list: vi.fn().mockResolvedValue([]), record: mocks.recordActivity }
}))
vi.mock('../lib/record-activity', () => ({
  recordActivity: mocks.recordActivity,
  queueFailedActivity: mocks.queueFailedActivity
}))
vi.mock('@renderer/ui/components/toaster', () => ({
  toast: { success: mocks.success, error: mocks.error, info: vi.fn() }
}))
vi.mock('@renderer/ui/components/data-table', () => ({
  DataTable: ({
    data,
    rowSelection,
    onRowSelectionChange
  }: {
    data: NodeRow[]
    rowSelection: Record<string, boolean>
    onRowSelectionChange: (next: Record<string, boolean>) => void
  }) => (
    <div>
      {data.map((node) => (
        <label key={node.name}>
          <input
            type="checkbox"
            checked={!!rowSelection[node.name]}
            onChange={(event) =>
              onRowSelectionChange({ ...rowSelection, [node.name]: event.currentTarget.checked })
            }
          />
          {node.name}
        </label>
      ))}
    </div>
  )
}))

import { NodesView } from './nodes-view'

const result = (node: string, status: DrainResult['status']): DrainResult => ({
  clusterId: 'cluster-a',
  node,
  status,
  reason:
    status === 'completed' ? undefined : 'Eviction rejected (HTTP 403); node remains cordoned',
  pods: [],
  remaining: status === 'completed' ? [] : [{ namespace: 'work', name: 'api', status: 'remaining' }]
})

function renderView(qc = new QueryClient()): QueryClient {
  render(
    <QueryClientProvider client={qc}>
      <NodesView clusterId="cluster-a" />
    </QueryClientProvider>
  )
  return qc
}

function selectNodes(count: number): void {
  for (const checkbox of screen.getAllByRole('checkbox').slice(0, count)) fireEvent.click(checkbox)
  fireEvent.click(screen.getByRole('button', { name: 'Drain' }))
}

beforeEach(() => {
  mocks.drain.mockReset()
  mocks.cordon.mockReset()
  mocks.uncordon.mockReset()
  mocks.success.mockReset()
  mocks.error.mockReset()
  mocks.recordActivity.mockReset()
  mocks.queueFailedActivity.mockReset()
  useActivityStore.setState({ records: [] })
})

describe('NodesView drain reporting', () => {
  it('cancels confirmation without starting a drain', () => {
    renderView()
    selectNodes(1)
    expect(screen.getByText(/Unmanaged pods and pods using emptyDir block/)).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(mocks.drain).not.toHaveBeenCalled()
  })

  it('shows progress and cancellation without reporting success', async () => {
    let resolveResult: (value: DrainResult) => void = () => undefined
    const cancel = vi.fn()
    mocks.drain.mockImplementation((_cluster, _node, onProgress) => {
      onProgress({ node: 'node-a', phase: 'waiting', message: 'Waiting for api', pods: [] })
      return {
        result: new Promise<DrainResult>((resolve) => {
          resolveResult = resolve
        }),
        cancel
      }
    })
    renderView()
    selectNodes(1)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Drain' }))
    expect(await screen.findByText('node-a: Waiting for api')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(cancel).toHaveBeenCalledOnce()
    resolveResult(result('node-a', 'cancelled'))
    expect(await screen.findByText(/node-a: cancelled/)).toBeInTheDocument()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith('Drain incomplete', expect.stringContaining('403'))
  })

  it('stops bulk drain at the first failure and leaves later nodes unprocessed', async () => {
    const blocked = result('node-a', 'failed')
    blocked.pods = [
      {
        namespace: 'work',
        name: 'api',
        status: 'blocked',
        reason: 'Pod uses local emptyDir storage'
      }
    ]
    mocks.drain.mockReturnValue({
      result: Promise.resolve(blocked),
      cancel: vi.fn()
    })
    renderView()
    selectNodes(2)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Drain' }))
    expect(await screen.findByText('Unprocessed: node-b')).toBeInTheDocument()
    expect(
      screen.getByText(/work\/api: blocked — Pod uses local emptyDir storage/)
    ).toBeInTheDocument()
    expect(screen.getByText(/Eligible pods last observed: work\/api/)).toBeInTheDocument()
    expect(mocks.drain).toHaveBeenCalledTimes(1)
    expect(mocks.success).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith('Drain incomplete', expect.any(String))
    )
  })

  it('shows success only for completed drain and stores its original-node activity', async () => {
    const completed = result('node-a', 'completed')
    completed.activityRecord = {
      id: 'activity-1',
      ts: 1,
      clusterId: 'cluster-a',
      clusterName: 'Production',
      action: 'drain',
      kind: 'nodes',
      name: 'node-a',
      count: 1,
      outcome: 'success'
    }
    mocks.drain.mockReturnValue({ result: Promise.resolve(completed), cancel: vi.fn() })
    renderView()
    selectNodes(1)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Drain' }))
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Drained 1 node'))
    expect(useActivityStore.getState().records[0].name).toBe('node-a')
    expect(mocks.recordActivity).not.toHaveBeenCalled()
  })

  it('records a failed start against the selected node', async () => {
    mocks.drain.mockImplementation(() => {
      throw new Error('already active')
    })
    mocks.recordActivity.mockResolvedValue(null)
    renderView()
    selectNodes(1)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Drain' }))
    await waitFor(() =>
      expect(mocks.recordActivity).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'node-a', outcome: 'error', message: 'already active' })
      )
    )
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('refreshes node and pod views on an incomplete drain and queues failed main-owned history', async () => {
    const blocked = result('node-a', 'failed')
    blocked.activityError = 'disk write failed'
    blocked.pods = [{ namespace: 'work', name: 'api', status: 'eviction-accepted' }]
    mocks.drain.mockReturnValue({ result: Promise.resolve(blocked), cancel: vi.fn() })
    const qc = new QueryClient()
    qc.setQueryData(qk.nodeDetail('cluster-a', 'node-a'), {})
    qc.setQueryData(qk.pods('cluster-a'), [])
    qc.setQueryData(qk.namespaceDetail('cluster-a', 'work'), {})
    renderView(qc)
    selectNodes(1)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Drain' }))
    await waitFor(() => expect(mocks.queueFailedActivity).toHaveBeenCalledOnce())
    expect(mocks.queueFailedActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'drain', name: 'node-a', outcome: 'error' })
    )
    for (const key of [
      qk.nodeDetail('cluster-a', 'node-a'),
      qk.pods('cluster-a'),
      qk.namespaceDetail('cluster-a', 'work')
    ]) {
      expect(qc.getQueryCache().find({ queryKey: key })?.state.isInvalidated).toBe(true)
    }
  })

  it('refreshes already cordoned nodes if a later node fails', async () => {
    mocks.cordon.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'))
    const qc = new QueryClient()
    qc.setQueryData(qk.nodeDetail('cluster-a', 'node-a'), {})
    qc.setQueryData(qk.nodeDetail('cluster-a', 'node-b'), {})
    renderView(qc)
    for (const checkbox of screen.getAllByRole('checkbox').slice(0, 2)) fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Cordon' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cordon' }))
    await waitFor(() => expect(mocks.cordon).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(
        qc.getQueryCache().find({ queryKey: qk.nodeDetail('cluster-a', 'node-a') })?.state
          .isInvalidated
      ).toBe(true)
    )
    expect(
      qc.getQueryCache().find({ queryKey: qk.nodeDetail('cluster-a', 'node-b') })?.state
        .isInvalidated
    ).toBe(false)
  })
})
