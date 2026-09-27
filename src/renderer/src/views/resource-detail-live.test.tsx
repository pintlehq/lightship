import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Pod, ResourceRow } from '../../../shared/ipc-types'
import { qk } from '../queries/keys'
import { invalidateMutation } from '../queries/mutation-invalidation'
import { CrdInstanceDetailView } from './crd-instance-detail-view'
import { PodDetailView } from './pod-detail-view'
import { ResourceDetailView } from './resource-detail-view'

const mocks = vi.hoisted(() => ({ pods: vi.fn(), resources: vi.fn(), custom: vi.fn() }))
vi.mock('../lib/ipc', async (original) => {
  const actual = await original<typeof import('../lib/ipc')>()
  return {
    ...actual,
    hasBackend: () => true,
    clusterApi: { ...actual.clusterApi, watch: () => () => {}, listCustomResource: mocks.custom }
  }
})
vi.mock('../data/fetchers', async (original) => ({
  ...(await original<typeof import('../data/fetchers')>()),
  fetchPods: mocks.pods,
  fetchResource: mocks.resources,
  fetchResourceDetail: vi.fn().mockResolvedValue({ labels: {} }),
  fetchEvents: vi.fn().mockResolvedValue([])
}))

const pod: Pod = {
  name: 'api',
  ns: 'web',
  status: 'Running',
  ready: '1/1',
  restarts: 0,
  cpu: '1m',
  mem: '1Mi',
  node: 'node-a',
  age: '1d',
  ip: '10.0.0.1',
  containers: []
}
const row: ResourceRow = {
  uid: 'original',
  name: 'api',
  namespace: 'web',
  age: '1d',
  columns: { ready: '1/2' }
}
const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })

beforeEach(() => {
  mocks.pods.mockReset().mockResolvedValue([pod])
  mocks.resources.mockReset().mockResolvedValue([row])
  mocks.custom.mockReset().mockImplementation((_id, params) =>
    Promise.resolve({
      columns: [{ key: 'value', header: 'Value' }],
      rows: [{ ...row, uid: params.group, columns: { value: params.group } }]
    })
  )
})

it('isolates custom resource groups and updates server-defined columns from Query', async () => {
  const qc = client()
  const first = { group: 'one.example', version: 'v1', plural: 'widgets', namespaced: true }
  const second = { ...first, group: 'two.example' }
  render(
    <QueryClientProvider client={qc}>
      <CrdInstanceDetailView
        clusterId="c1"
        {...first}
        crdKind="Widget"
        namespace="web"
        name="api"
      />
      <CrdInstanceDetailView
        clusterId="c1"
        {...second}
        crdKind="Widget"
        namespace="web"
        name="api"
      />
    </QueryClientProvider>
  )
  await screen.findByText('one.example')
  await screen.findByText('two.example')
  act(() =>
    qc.setQueryData(qk.customResource('c1', first), {
      columns: [{ key: 'revision', header: 'Revision' }],
      rows: [{ ...row, uid: 'one.example', columns: { revision: 'new revision' } }]
    })
  )
  await screen.findByText('new revision')
  expect(screen.getByText('two.example')).toBeInTheDocument()
  expect(screen.queryByText('one.example')).not.toBeInTheDocument()
})

it('reads live pod rows from Query and removes actions when the pod disappears', async () => {
  const qc = client()
  render(
    <QueryClientProvider client={qc}>
      <PodDetailView clusterId="c1" namespace="web" name="api" />
    </QueryClientProvider>
  )
  await screen.findByText('Running')
  act(() => qc.setQueryData(qk.pods('c1'), [{ ...pod, status: 'CrashLoopBackOff', restarts: 3 }]))
  await screen.findByText('CrashLoopBackOff')
  expect(screen.queryByText('Running')).not.toBeInTheDocument()
  act(() => qc.setQueryData(qk.pods('c1'), []))
  await screen.findByText(/api was not found/)
  expect(screen.queryByRole('button', { name: 'Forward' })).not.toBeInTheDocument()
})

it('revalidates a cached row on reopening and shows an error instead of stale actions', async () => {
  const qc = client()
  qc.setQueryData(qk.pods('c1'), [pod])
  mocks.pods.mockRejectedValueOnce(new Error('Forbidden'))
  const first = render(
    <QueryClientProvider client={qc}>
      <PodDetailView clusterId="c1" namespace="web" name="api" />
    </QueryClientProvider>
  )
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  expect(screen.queryByRole('button', { name: 'Forward' })).not.toBeInTheDocument()
  await screen.findByRole('alert')
  expect(screen.getByRole('alert')).toHaveTextContent('Forbidden')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('Running')
  first.unmount()
  mocks.pods.mockResolvedValue([{ ...pod, status: 'Pending' }])
  render(
    <QueryClientProvider client={qc}>
      <PodDetailView clusterId="c1" namespace="web" name="api" />
    </QueryClientProvider>
  )
  await screen.findByText('Pending')
  expect(mocks.pods).toHaveBeenCalledTimes(3)
})

it('refreshes detail columns after mutations and follows a replacement with the same name', async () => {
  const qc = client()
  render(
    <QueryClientProvider client={qc}>
      <ResourceDetailView
        clusterId="c1"
        resourceId="deployments"
        namespace="web"
        name="api"
        label="api"
      />
    </QueryClientProvider>
  )
  await waitFor(() => expect(screen.getAllByText('1/2').length).toBeGreaterThan(0))
  mocks.resources.mockResolvedValue([{ ...row, uid: 'replacement', columns: { ready: '3/3' } }])
  await act(() =>
    invalidateMutation(qc, 'c1', {
      type: 'resource',
      operation: 'scale',
      refs: [{ kind: 'deployments', namespace: 'web', name: 'api' }]
    })
  )
  await waitFor(() => expect(screen.getAllByText('3/3').length).toBeGreaterThan(0))
  expect(screen.queryByText('1/2')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Scale' })).toBeEnabled()
})
