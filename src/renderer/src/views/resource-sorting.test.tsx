import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type {
  HelmRelease,
  NamespaceSummary,
  NodeRow,
  Pod,
  ResourceRow
} from '../../../shared/ipc-types'
import { PodsView } from './pods-view'
import { ResourceListView } from './resource-list-view'
import { NodesView } from '../features/nodes/nodes-view'
import { NamespacesView } from './namespaces-view'
import { CrdInstancesView } from './crd-instances-view'
import { HelmView } from './helm-view'
import { HelmReleaseView } from './helm-release-view'

const names = ['service10', 'Service2', 'service1']
const ages = ['1d', '2h', '30m']
const counts = [10, 2, 1]
const resources: ResourceRow[] = names.map((name, i) => ({
  uid: name,
  name,
  namespace: 'work',
  age: ages[i],
  columns: {
    ready: `${counts[i]}/20`,
    available: String(counts[i]),
    'up-to-date': String(counts[i])
  }
}))
const pods: Pod[] = names.map((name, i) => ({
  name,
  ns: 'work',
  status: 'Running',
  ready: '1/1',
  restarts: counts[i],
  cpu: ['2', '500m', '—'][i],
  mem: ['1Gi', '512Mi', '—'][i],
  node: 'node',
  age: ages[i],
  ip: '1.2.3.4',
  containers: Array.from({ length: counts[i] }, (_, n) => ({
    name: `c${n}`,
    ready: true,
    state: 'Running'
  }))
}))
const nodes: NodeRow[] = names.map((name, i) => ({
  name,
  roles: i === 1 ? ['control-plane'] : ['worker'],
  status: 'Ready',
  cpuPct: counts[i],
  cpu: '1',
  memPct: counts[i],
  mem: '1Gi',
  pods: counts[i],
  maxPods: 20,
  ver: 'v1.35',
  zone: 'zone',
  type: 'instance',
  age: ages[i],
  ip: '1.2.3.4',
  cordoned: false
}))
const namespaces: NamespaceSummary[] = names.map((name, i) => ({
  name,
  uid: name,
  status: 'Active',
  created: '',
  age: ages[i],
  protected: i === 2,
  podsReady: counts[i],
  podsTotal: 20,
  quotaCount: i === 2 ? null : counts[i],
  limitRangeCount: 0,
  networkPolicyCount: 0,
  defaultDenyIngress: false,
  defaultDenyEgress: false
}))
const helm: HelmRelease[] = names.map((name, i) => ({
  name,
  namespace: 'work',
  revision: counts[i],
  chart: 'chart',
  chartVersion: '1.0',
  appVersion: '1.0',
  status: 'deployed',
  updated: ages[i]
}))
const access = {
  pods: { available: true },
  quotas: { available: true },
  limits: { available: true },
  policies: { available: true }
}

// Keep the real table and column definitions; expose all rows in this layout-free environment.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 33,
        end: (index + 1) * 33
      })),
    getTotalSize: () => count * 33,
    scrollToIndex: vi.fn()
  })
}))
vi.mock('../queries/clusters', () => ({ useClusters: () => ({ data: [] }) }))
vi.mock('../queries/pods', () => ({ usePods: () => ({ data: pods }) }))
vi.mock('../features/nodes/queries', () => ({ useNodes: () => ({ data: nodes }) }))
vi.mock('../queries/helm', () => ({
  useHelmReleases: () => ({ data: helm }),
  useHelmRevisions: () => ({ data: helm })
}))
vi.mock('../queries/resources', () => ({
  useResource: () => ({ data: resources }),
  useCustomResource: () => ({
    data: { rows: resources, columns: [{ key: 'available', header: 'Count' }] }
  }),
  useCreateFromYaml: () => ({ mutateAsync: vi.fn(), isPending: false })
}))
vi.mock('../queries/namespaces', () => ({
  useNamespaces: () => ({ data: [] }),
  useNamespaceSummaries: () => ({ data: { items: namespaces, access } }),
  useDeleteNamespace: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateNamespace: () => ({ mutateAsync: vi.fn(), isPending: false })
}))

function renderView(view: ReactElement) {
  return render(<QueryClientProvider client={new QueryClient()}>{view}</QueryClientProvider>)
}
function orderedNames(): string[] {
  return Array.from(screen.getByRole('table').querySelectorAll('tbody tr')).map(
    (row) =>
      Array.from(row.querySelectorAll('td'))
        .map((cell) => cell.textContent?.trim() ?? '')
        .find((text) => names.includes(text)) ?? ''
  )
}
const noop = () => undefined
const views: [string, () => ReactElement][] = [
  [
    'Pods',
    () => (
      <PodsView clusterId="test" tabId="test" onOpenPod={noop} onOpenLogs={noop} onExec={noop} />
    )
  ],
  [
    'Deployments',
    () => (
      <ResourceListView
        clusterId="test"
        resourceId="deployments"
        label="Deployments"
        tabId="test"
      />
    )
  ],
  ['Nodes', () => <NodesView clusterId="test" />],
  [
    'Namespaces',
    () => <NamespacesView clusterId="test" onOpenNamespace={noop} onOpenResource={noop} />
  ],
  [
    'Custom resources',
    () => (
      <CrdInstancesView
        clusterId="test"
        group="test"
        version="v1"
        plural="things"
        namespaced
        label="Things"
      />
    )
  ],
  ['Helm', () => <HelmView clusterId="test" onOpenRelease={noop} />]
]

describe('resource list sorting', () => {
  it.each(views)('%s sorts by header and resets source order', (_name, view) => {
    renderView(view())
    const header = screen.getByTestId('data-table-sort-name').closest('th')
    if (!header) throw new Error('Expected a sortable header')
    fireEvent.click(header)
    expect(orderedNames()).toEqual(['service1', 'Service2', 'service10'])
    fireEvent.click(header)
    expect(orderedNames()).toEqual(['service10', 'Service2', 'service1'])
    fireEvent.click(header)
    expect(orderedNames()).toEqual(names)
  })

  it('Pods compares CPU, memory, containers and elapsed age', () => {
    renderView(views[0][1]())
    for (const key of ['cpu', 'mem']) {
      fireEvent.click(screen.getByTestId(`data-table-sort-${key}`))
      expect(orderedNames()).toEqual(['Service2', 'service10', 'service1'])
      fireEvent.click(screen.getByTestId(`data-table-sort-${key}`))
      expect(orderedNames()).toEqual(['service10', 'Service2', 'service1'])
    }
    for (const key of ['containers', 'age', 'restarts']) {
      fireEvent.click(screen.getByTestId(`data-table-sort-${key}`))
      expect(orderedNames()).toEqual(['service1', 'Service2', 'service10'])
    }
  })

  it('Deployments compares readiness and numeric printer columns', () => {
    renderView(views[1][1]())
    for (const key of ['ready', 'available', 'age']) {
      fireEvent.click(screen.getByTestId(`data-table-sort-${key}`))
      expect(orderedNames()).toEqual(['service1', 'Service2', 'service10'])
    }
  })

  it('Nodes compares displayed roles', () => {
    renderView(views[2][1]())
    fireEvent.click(screen.getByTestId('data-table-sort-role'))
    expect(orderedNames()).toEqual(['Service2', 'service10', 'service1'])
  })

  it('Namespaces retains sorting after an empty filter and keeps unavailable counts last', () => {
    renderView(views[3][1]())
    fireEvent.click(screen.getByTestId('data-table-sort-quotaCount'))
    expect(orderedNames()).toEqual(['Service2', 'service10', 'service1'])
    fireEvent.click(screen.getByTestId('data-table-sort-quotaCount'))
    expect(orderedNames()).toEqual(['service10', 'Service2', 'service1'])
    fireEvent.change(screen.getByPlaceholderText('Filter namespaces…'), {
      target: { value: 'absent' }
    })
    expect(screen.getByText('No namespaces found')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Filter namespaces…'), { target: { value: '' } })
    expect(orderedNames()).toEqual(['service10', 'Service2', 'service1'])
  })

  it('Helm revisions compares numeric revisions and elapsed update times', () => {
    renderView(<HelmReleaseView clusterId="test" namespace="work" name="release" label="Release" />)
    const revisions = () =>
      Array.from(screen.getByRole('table').querySelectorAll('tbody tr td:first-child')).map(
        (cell) => cell.textContent
      )
    fireEvent.click(screen.getByTestId('data-table-sort-revision'))
    expect(revisions()).toEqual(['1', '2', '10'])
    fireEvent.click(screen.getByTestId('data-table-sort-updated'))
    expect(revisions()).toEqual(['1', '2', '10'])
  })

  it('Namespaces preserves protected actions and does not navigate when opening the menu', async () => {
    const user = userEvent.setup()
    const open = vi.fn()
    renderView(<NamespacesView clusterId="test" onOpenNamespace={open} onOpenResource={noop} />)
    await user.click(screen.getByTestId('data-table-sort-age'))
    const trigger = screen.getAllByRole('button', { name: 'Row actions' })[0]
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(open).not.toHaveBeenCalled()
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })
})
