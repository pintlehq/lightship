import type {
  ActivityInput,
  ActivityRecord,
  ClusterAddSelection,
  ClusterEvent,
  ClusterMeta,
  ClusterOverview,
  ConfigData,
  CustomResourceList,
  CustomResourceParams,
  DetectedContext,
  HelmRelease,
  LightshipApi,
  LogEvent,
  LogStreamOptions,
  NodeDetail,
  NodeRow,
  NamespaceCreateInput,
  NamespaceDetail,
  NamespaceSummaryList,
  OverviewBundle,
  Pod,
  PortForwardEvent,
  PortForwardHandle,
  PortForwardOptions,
  PtyEvent,
  PtyOptions,
  ResourceDetail,
  ResourceRef,
  ResourceRow,
  TerminalHandle,
  TestResult,
  WatchEvent
} from '../../../shared/ipc-types'

// `window.api` exists only inside Electron. In a plain browser (headless dev),
// it's undefined — callers fall back to safe defaults / mock data.
const api = (): LightshipApi | undefined => (typeof window !== 'undefined' ? window.api : undefined)

export const hasBackend = (): boolean => !!api()

// E2E seam: the Playwright suite serves the renderer with Vite `--mode e2e` (no
// Electron backend). The cluster list is the only thing that can't fall back to
// mock data on its own, so seed one mock cluster here to unlock the whole UI;
// every other read already returns mock data via data/fetchers when !hasBackend().
// Dead code (tree-shaken) in real dev/build, where MODE is development/production.
const E2E = import.meta.env.MODE === 'e2e'
const E2E_CLUSTERS: ClusterMeta[] = [
  { id: 'e2e', name: 'e2e-cluster', context: 'e2e', server: 'https://e2e.local', env: 'dev' }
]

export const clustersApi = {
  list: (): Promise<ClusterMeta[]> =>
    api()?.clusters.list() ?? Promise.resolve(E2E ? E2E_CLUSTERS : []),
  detect: (): Promise<DetectedContext[]> => api()?.clusters.detect() ?? Promise.resolve([]),
  parse: (yaml: string): Promise<DetectedContext[]> =>
    api()?.clusters.parse(yaml) ?? Promise.resolve([]),
  add: (selections: ClusterAddSelection[]): Promise<ClusterMeta[]> =>
    api()?.clusters.add(selections) ?? Promise.resolve([]),
  remove: (id: string): Promise<void> => api()?.clusters.remove(id) ?? Promise.resolve(),
  rename: (id: string, name: string): Promise<void> =>
    api()?.clusters.rename(id, name) ?? Promise.resolve(),
  reorder: (ids: string[]): Promise<ClusterMeta[]> =>
    api()?.clusters.reorder(ids) ??
    Promise.resolve(E2E ? ids.flatMap((id) => E2E_CLUSTERS.filter((c) => c.id === id)) : []),
  test: (id: string): Promise<TestResult> =>
    api()?.clusters.test(id) ?? Promise.resolve({ ok: false, error: 'Backend unavailable' })
}

// Persisted renderer UI state. No-ops to safe defaults without a backend (plain
// browser / headless dev), so the renderer still runs and just won't remember.
export const uiStateApi = {
  getDetailTabs: (): Promise<Record<string, string>> =>
    api()?.uiState.getDetailTabs() ?? Promise.resolve({}),
  setDetailTab: (key: string, tab: string): Promise<void> =>
    api()?.uiState.setDetailTab(key, tab) ?? Promise.resolve()
}

// Global Activity history. Without a backend (plain browser / headless dev),
// record is a no-op (returns null) and list is empty.
export const activityApi = {
  record: (input: ActivityInput): Promise<ActivityRecord | null> =>
    api()?.activity.record(input) ?? Promise.resolve(null),
  list: (): Promise<ActivityRecord[]> => api()?.activity.list() ?? Promise.resolve([]),
  clear: (): Promise<void> => api()?.activity.clear() ?? Promise.resolve()
}

// Resource reads — callers guard with hasBackend() (mock fallback lives in
// data/fetchers.ts), so these assert the backend is present.
export const clusterApi = {
  overview: (id: string): Promise<ClusterOverview> => api()!.cluster.overview(id),
  overviewBundle: (id: string): Promise<OverviewBundle> => api()!.cluster.overviewBundle(id),
  nodes: (id: string): Promise<NodeRow[]> => api()!.cluster.nodes(id),
  namespaceSummaries: (id: string): Promise<NamespaceSummaryList> =>
    api()!.cluster.namespaceSummaries(id),
  namespaceDetail: (id: string, name: string): Promise<NamespaceDetail> =>
    api()!.cluster.namespaceDetail(id, name),
  createNamespace: (id: string, input: NamespaceCreateInput): Promise<void> =>
    api()!.cluster.createNamespace(id, input),
  deleteNamespace: (id: string, name: string): Promise<void> =>
    api()!.cluster.deleteNamespace(id, name),
  nodeDetail: (id: string, name: string): Promise<NodeDetail> =>
    api()!.cluster.nodeDetail(id, name),
  events: (id: string, ref?: ResourceRef): Promise<ClusterEvent[]> =>
    api()!.cluster.events(id, ref),
  listResource: (id: string, kind: string, namespace?: string): Promise<ResourceRow[]> =>
    api()!.cluster.listResource(id, kind, namespace),
  listCustomResource: (id: string, params: CustomResourceParams): Promise<CustomResourceList> =>
    api()!.cluster.listCustomResource(id, params),
  helmReleases: (id: string): Promise<HelmRelease[]> => api()!.cluster.helmReleases(id),
  helmRevisions: (id: string, namespace: string, name: string): Promise<HelmRelease[]> =>
    api()!.cluster.helmRevisions(id, namespace, name),
  pods: (id: string): Promise<Pod[]> => api()!.cluster.pods(id),
  deleteResource: (id: string, ref: ResourceRef): Promise<void> =>
    api()!.cluster.deleteResource(id, ref),
  rolloutRestart: (id: string, ref: ResourceRef): Promise<void> =>
    api()!.cluster.rolloutRestart(id, ref),
  scaleResource: (id: string, ref: ResourceRef, replicas: number): Promise<void> =>
    api()!.cluster.scaleResource(id, ref, replicas),
  cordon: (id: string, name: string): Promise<void> => api()!.cluster.cordon(id, name),
  uncordon: (id: string, name: string): Promise<void> => api()!.cluster.uncordon(id, name),
  drain: (id: string, name: string): Promise<void> => api()!.cluster.drain(id, name),
  getYaml: (id: string, ref: ResourceRef): Promise<string> => api()!.cluster.getYaml(id, ref),
  applyYaml: (id: string, ref: ResourceRef, yaml: string): Promise<void> =>
    api()!.cluster.applyYaml(id, ref, yaml),
  createYaml: (id: string, yaml: string): Promise<void> => api()!.cluster.createYaml(id, yaml),
  getResourceDetail: (id: string, ref: ResourceRef): Promise<ResourceDetail> =>
    api()!.cluster.getResourceDetail(id, ref),
  getConfigData: (id: string, ref: ResourceRef): Promise<ConfigData> =>
    api()!.cluster.getConfigData(id, ref),
  applyConfigData: (id: string, ref: ResourceRef, data: Record<string, string>): Promise<void> =>
    api()!.cluster.applyConfigData(id, ref, data),
  streamLogs: (
    id: string,
    ref: ResourceRef,
    opts: LogStreamOptions,
    onEvent: (ev: LogEvent) => void
  ): (() => void) => api()!.cluster.streamLogs(id, ref, opts, onEvent),
  openTerminal: (id: string, opts: PtyOptions, onEvent: (ev: PtyEvent) => void): TerminalHandle =>
    api()!.cluster.openTerminal(id, opts, onEvent),
  startPortForward: (
    id: string,
    ref: ResourceRef,
    opts: PortForwardOptions,
    onEvent: (ev: PortForwardEvent) => void
  ): PortForwardHandle => api()!.cluster.startPortForward(id, ref, opts, onEvent),
  watch: (id: string, kind: string, onEvent: (ev: WatchEvent) => void): (() => void) =>
    api()!.cluster.watch(id, kind, onEvent)
}
