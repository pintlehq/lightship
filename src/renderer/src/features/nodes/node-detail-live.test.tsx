import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { NodeDetail, NodeRow } from '../../../../shared/ipc-types'
import { qk } from '../../queries/keys'
import { NodeDetailView } from './node-detail-view'

vi.mock('../../data/fetchers', async (original) => ({
  ...(await original<typeof import('../../data/fetchers')>()),
  fetchNodes: async () => [node],
  fetchNodeDetail: async () => detail,
  fetchEvents: async () => [],
  fetchPods: async () => []
}))

const node: NodeRow = {
  name: 'worker',
  roles: ['worker'],
  status: 'Ready',
  cpuPct: 10,
  cpu: '1 / 10',
  memPct: 10,
  mem: '1Gi / 10Gi',
  pods: 0,
  maxPods: 100,
  ver: 'v1.35',
  zone: 'zone-a',
  type: 'worker',
  age: '1d',
  ip: '10.0.0.1',
  cordoned: false
}
const detail: NodeDetail = {
  name: 'worker',
  created: '',
  labels: {},
  annotations: {},
  addresses: [],
  roles: ['worker'],
  os: 'linux',
  arch: 'amd64',
  osImage: 'current image',
  kernelVersion: '',
  containerRuntime: '',
  kubeletVersion: '',
  zone: '',
  instanceType: '',
  conditions: [],
  capacity: [],
  allocatable: [],
  allocated: [],
  cpuPct: 10,
  cpu: '1 / 10',
  memPct: 10,
  mem: '1Gi / 10Gi',
  cpuReqPct: 0,
  cpuRequest: '0',
  memReqPct: 0,
  memRequest: '0'
}

it('reflects updated node readiness and cordon state without reopening the tab', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <NodeDetailView clusterId="c1" name="worker" />
    </QueryClientProvider>
  )
  await screen.findByText('Ready', { exact: true })
  act(() => qc.setQueryData(qk.nodes('c1'), [{ ...node, status: 'NotReady', cordoned: true }]))
  await screen.findByText('NotReady', { exact: true })
  expect(screen.getByText('cordoned')).toBeInTheDocument()
  act(() => qc.setQueryData(qk.nodes('c1'), []))
  await screen.findByText(/worker was not found/)
  expect(screen.queryByRole('button', { name: 'Properties' })).not.toBeInTheDocument()
})

it('revalidates cached node properties when a detail tab mounts again', async () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  })
  qc.setQueryData(qk.nodeDetail('c1', 'worker'), { ...detail, osImage: 'previous image' })
  render(
    <QueryClientProvider client={qc}>
      <NodeDetailView clusterId="c1" name="worker" />
    </QueryClientProvider>
  )
  await screen.findByText('current image')
  expect(screen.queryByText('previous image')).not.toBeInTheDocument()
})
