// Zod schemas + inferred types shared across main / preload / renderer for the
// Lightship IPC surface. Schemas are the single source of truth — types are inferred
// via `z.infer`, so a schema and its type can never drift. Grows per phase.

import { z } from 'zod'

export const ClusterMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  context: z.string(),
  server: z.string(),
  env: z.string().optional()
})
export type ClusterMeta = z.infer<typeof ClusterMetaSchema>
export const ClusterMetaArraySchema = z.array(ClusterMetaSchema)

export const DetectedContextSchema = z.object({
  name: z.string(),
  cluster: z.string(),
  user: z.string(),
  server: z.string(),
  /** true if a cluster with this context name is already saved */
  alreadyAdded: z.boolean().optional()
})
export type DetectedContext = z.infer<typeof DetectedContextSchema>
export const DetectedContextArraySchema = z.array(DetectedContextSchema)

/** `kubeconfig` present → from pasted YAML; absent → from the default kubeconfig. */
export const ClusterAddSelectionSchema = z.object({
  context: z.string().min(1),
  kubeconfig: z.string().optional()
})
export type ClusterAddSelection = z.infer<typeof ClusterAddSelectionSchema>
export const ClusterAddSelectionArraySchema = z.array(ClusterAddSelectionSchema)

export const ClusterOrderSchema = z.array(z.string().min(1))
export type ClusterOrder = z.infer<typeof ClusterOrderSchema>

export const TestResultSchema = z.object({
  ok: z.boolean(),
  version: z.string().optional(),
  error: z.string().optional()
})
export type TestResult = z.infer<typeof TestResultSchema>

// The node row shape shared by the renderer table and the IPC layer.
export const NodeRowSchema = z.object({
  name: z.string(),
  roles: z.array(z.string()),
  status: z.string(),
  cpuPct: z.number(),
  cpu: z.string(),
  memPct: z.number(),
  mem: z.string(),
  pods: z.number(),
  maxPods: z.number(),
  ver: z.string(),
  zone: z.string(),
  type: z.string(),
  age: z.string(),
  ip: z.string(),
  taint: z.string().optional(),
  /** Cordoned (spec.unschedulable) — no new pods scheduled here. */
  cordoned: z.boolean()
})
export type NodeRow = z.infer<typeof NodeRowSchema>
export const NodeRowArraySchema = z.array(NodeRowSchema)

/** One `status.addresses[]` entry of a node. */
export const NodeAddressSchema = z.object({ type: z.string(), address: z.string() })
export type NodeAddress = z.infer<typeof NodeAddressSchema>

export const NodeResourceValueSchema = z.object({
  resource: z.string(),
  value: z.string()
})
export type NodeResourceValue = z.infer<typeof NodeResourceValueSchema>

export const NodeAllocatedResourceSchema = z.object({
  resource: z.string(),
  requests: z.string(),
  requestsPct: z.number().nullable(),
  limits: z.string(),
  limitsPct: z.number().nullable()
})
export type NodeAllocatedResource = z.infer<typeof NodeAllocatedResourceSchema>

export const ClusterOverviewSchema = z.object({
  nodes: z.number(),
  nodesReady: z.number(),
  pods: z.number(),
  podsCapacity: z.number(),
  /** null when metrics-server is unavailable. */
  cpuPct: z.number().nullable(),
  memPct: z.number().nullable(),
  /** Requested resources (sum of pod requests) vs allocatable — always computed. */
  cpuReqPct: z.number(),
  cpuRequest: z.string(),
  memReqPct: z.number(),
  memRequest: z.string(),
  namespaces: z.number()
})
export type ClusterOverview = z.infer<typeof ClusterOverviewSchema>

/** A generic resource list row. `columns` holds kind-specific display values
 *  keyed by the column id from the renderer's resource registry. */
export const ResourceRowSchema = z.object({
  uid: z.string(),
  namespace: z.string().optional(),
  name: z.string(),
  age: z.string(),
  columns: z.record(z.string(), z.string())
})
export type ResourceRow = z.infer<typeof ResourceRowSchema>
export const ResourceRowArraySchema = z.array(ResourceRowSchema)

/** One container's name + readiness/state, for the Container column + menus. */
export const ContainerStatusSchema = z.object({
  name: z.string(),
  ready: z.boolean(),
  state: z.string()
})
export type ContainerStatus = z.infer<typeof ContainerStatusSchema>

// The pod row shape shared by the renderer table and the IPC layer.
export const PodSchema = z.object({
  name: z.string(),
  ns: z.string(),
  status: z.string(),
  ready: z.string(),
  restarts: z.number(),
  cpu: z.string(),
  mem: z.string(),
  node: z.string(),
  age: z.string(),
  ip: z.string(),
  /** Per-container readiness/state (Container column; names drive Logs/Exec menus). */
  containers: z.array(ContainerStatusSchema)
})
export type Pod = z.infer<typeof PodSchema>
export const PodArraySchema = z.array(PodSchema)

/** Target for a mutation (delete / rolling restart). */
export const ResourceRefSchema = z.object({
  kind: z.string().min(1),
  namespace: z.string().optional(),
  name: z.string().min(1),
  /** For a custom-resource instance: its `group/version`, so the backend can
   *  resolve a dynamic GVK that isn't in the static kind table. Ignored for
   *  built-in kinds (resolved via the static table). */
  apiVersion: z.string().optional()
})
export type ResourceRef = z.infer<typeof ResourceRefSchema>

/** Desired replica count for scalable workloads. */
export const ScaleReplicasSchema = z.number().int().nonnegative()
export type ScaleReplicas = z.infer<typeof ScaleReplicasSchema>

/** Options for starting a port-forward (localPort 0 = OS-assigned). */
export const PortForwardOptionsSchema = z.object({ remotePort: z.number(), localPort: z.number() })
export type PortForwardOptions = z.infer<typeof PortForwardOptionsSchema>

/** A push event on a port-forward channel (main → renderer). */
export const PortForwardEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('running'), localPort: z.number() }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('closed') })
])
export type PortForwardEvent = z.infer<typeof PortForwardEventSchema>

/** Handle returned by the preload bridge for an active port-forward. */
export interface PortForwardHandle {
  stop(): void
}

/** A recent cluster event (from the Kubernetes events API). */
export const ClusterEventSchema = z.object({
  type: z.string(),
  reason: z.string(),
  object: z.string(),
  message: z.string(),
  age: z.string()
})
export type ClusterEvent = z.infer<typeof ClusterEventSchema>
export const ClusterEventArraySchema = z.array(ClusterEventSchema)

export const OverviewBundleSchema = z.object({
  overview: ClusterOverviewSchema,
  events: ClusterEventArraySchema
})
export type OverviewBundle = z.infer<typeof OverviewBundleSchema>

/** A push event on a terminal (pty) channel (main → renderer). */
export const PtyEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('data'), data: z.string() }),
  z.object({ type: z.literal('exit'), exitCode: z.number() }),
  z.object({ type: z.literal('error'), message: z.string() })
])
export type PtyEvent = z.infer<typeof PtyEventSchema>

/** Options for opening a pty: terminal geometry, plus an optional exec target.
 *  When `namespace` + `pod` are present the shell is a `kubectl exec` into the pod
 *  (else a plain kube-shell). The k8s-name regex keeps the values safe to splice
 *  into the exec command (no shell metacharacters). */
const KubeName = z.string().regex(/^[a-zA-Z0-9._-]+$/)
export const PtyOptionsSchema = z.object({
  cols: z.number(),
  rows: z.number(),
  namespace: KubeName.optional(),
  pod: KubeName.optional(),
  container: KubeName.optional()
})
export type PtyOptions = z.infer<typeof PtyOptionsSchema>

/** A live terminal session handle returned by the preload bridge. Carries
 *  functions, so it stays a plain interface (not a zod schema). */
export interface TerminalHandle {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

/** One container of a pod, for the detail Overview. */
export const ContainerInfoSchema = z.object({
  name: z.string(),
  image: z.string(),
  ready: z.boolean(),
  state: z.string(),
  restarts: z.number()
})
export type ContainerInfo = z.infer<typeof ContainerInfoSchema>

/** A port exposed by a resource (service port, or container port). */
export const PortInfoSchema = z.object({
  name: z.string().optional(),
  port: z.number(),
  protocol: z.string().optional()
})
export type PortInfo = z.infer<typeof PortInfoSchema>

/** A `.status.conditions[]` entry (Ready/Installed/…), shown as a badge. */
export const ResourceConditionSchema = z.object({
  type: z.string(),
  status: z.string(),
  reason: z.string().optional()
})
export type ResourceCondition = z.infer<typeof ResourceConditionSchema>

/** Full detail for one node, for the node detail view's Properties tab. */
export const NodeDetailSchema = z.object({
  name: z.string(),
  /** ISO creation timestamp. */
  created: z.string(),
  labels: z.record(z.string(), z.string()),
  annotations: z.record(z.string(), z.string()),
  addresses: z.array(NodeAddressSchema),
  roles: z.array(z.string()),
  os: z.string(),
  arch: z.string(),
  osImage: z.string(),
  kernelVersion: z.string(),
  containerRuntime: z.string(),
  kubeletVersion: z.string(),
  zone: z.string(),
  instanceType: z.string(),
  conditions: z.array(ResourceConditionSchema),
  capacity: z.array(NodeResourceValueSchema),
  allocatable: z.array(NodeResourceValueSchema),
  allocated: z.array(NodeAllocatedResourceSchema),
  /** Live usage (point-in-time), formatted like NodeRow. */
  cpuPct: z.number(),
  cpu: z.string(),
  memPct: z.number(),
  mem: z.string(),
  /** Requested resources (sum of pod requests on this node) vs allocatable. */
  cpuReqPct: z.number(),
  cpuRequest: z.string(),
  memReqPct: z.number(),
  memRequest: z.string()
})
export type NodeDetail = z.infer<typeof NodeDetailSchema>

/** Live object fields shown on a resource's Overview tab. Pod-only fields are
 *  absent for other kinds; the generic fields (created/finalizers/conditions)
 *  populate for any object and drive the custom-resource detail. */
export const ResourceDetailSchema = z.object({
  labels: z.record(z.string(), z.string()),
  qosClass: z.string().optional(),
  cpuLimit: z.string().optional(),
  memLimit: z.string().optional(),
  containers: z.array(ContainerInfoSchema).optional(),
  ports: z.array(PortInfoSchema).optional(),
  created: z.string().optional(),
  finalizers: z.array(z.string()).optional(),
  conditions: z.array(ResourceConditionSchema).optional()
})
export type ResourceDetail = z.infer<typeof ResourceDetailSchema>

/** A custom-resource instances listing: the CRD's server print columns + rows. */
export const CustomResourceColumnSchema = z.object({ key: z.string(), header: z.string() })
export type CustomResourceColumn = z.infer<typeof CustomResourceColumnSchema>
export const CustomResourceListSchema = z.object({
  columns: z.array(CustomResourceColumnSchema),
  rows: z.array(ResourceRowSchema)
})
export type CustomResourceList = z.infer<typeof CustomResourceListSchema>

/** A single streamed log line, tagged with its source pod + container. */
export const LogLineSchema = z.object({
  pod: z.string(),
  container: z.string(),
  ts: z.string(),
  msg: z.string()
})
export type LogLine = z.infer<typeof LogLineSchema>

/** A push event on a log subscription channel (main → renderer). */
export const LogEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lines'), items: z.array(LogLineSchema) }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('end') })
])
export type LogEvent = z.infer<typeof LogEventSchema>

/** Options for a log stream. */
export const LogStreamOptionsSchema = z.object({
  tailLines: z.number().optional(),
  /** Restrict to a single container (default: all containers of all matched pods). */
  container: z.string().optional()
})
export type LogStreamOptions = z.infer<typeof LogStreamOptionsSchema>

/** The key/value data of a ConfigMap or Secret. Secret values are decoded to
 *  utf-8 text; entries whose bytes aren't text are reported as `binaryKeys`
 *  (shown read-only and preserved untouched on save). */
export const ConfigDataSchema = z.object({
  secret: z.boolean(),
  data: z.record(z.string(), z.string()),
  binaryKeys: z.array(z.string())
})
export type ConfigData = z.infer<typeof ConfigDataSchema>

/** One row in a live watch stream. Which concrete shape it is depends on the
 *  watched kind: `pods` → Pod, `nodes` → NodeRow, every other kind → ResourceRow.
 *  The subscriber knows which it asked for. */
export const WatchRowSchema = z.union([PodSchema, ResourceRowSchema, NodeRowSchema])
export type WatchRow = z.infer<typeof WatchRowSchema>

/** A single incremental change in a watch stream. */
export const WatchDeltaSchema = z.object({
  op: z.enum(['added', 'modified', 'deleted']),
  row: WatchRowSchema
})
export type WatchDelta = z.infer<typeof WatchDeltaSchema>

/** A push event on a watch subscription channel (main → renderer): a full
 *  snapshot on (re)list, a batch of incremental deltas, or a connection status
 *  change. Like log/pty events, these are typed but not re-validated per event. */
export const WatchEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reset'), rows: z.array(WatchRowSchema) }),
  z.object({ type: z.literal('deltas'), items: z.array(WatchDeltaSchema) }),
  z.object({
    type: z.literal('status'),
    state: z.enum(['connected', 'error']),
    message: z.string().optional()
  })
])
export type WatchEvent = z.infer<typeof WatchEventSchema>

/** Identifies a CRD whose live instances to list (dynamic GVK). */
export const CustomResourceParamsSchema = z.object({
  group: z.string(),
  version: z.string().min(1),
  plural: z.string().min(1),
  namespaced: z.boolean()
})
export type CustomResourceParams = z.infer<typeof CustomResourceParamsSchema>

/** Persisted, non-sensitive renderer UI state (kept on disk so it survives
 *  restarts). `detailTabs` maps a per-resource key (see `detailTabKey`) to the
 *  last-viewed sub-tab of that resource's detail view. */
export const UiStateSchema = z
  .object({ detailTabs: z.record(z.string(), z.string()).default({}) })
  .catch({ detailTabs: {} })
export type UiState = z.infer<typeof UiStateSchema>

/** One recorded mutating action, persisted to the global Activity history. */
export const ActivityOutcomeSchema = z.enum(['success', 'error'])
export type ActivityOutcome = z.infer<typeof ActivityOutcomeSchema>

export const ActivityActionSchema = z.enum([
  'delete',
  'restart',
  'scale',
  'cordon',
  'uncordon',
  'drain',
  'apply-yaml',
  'create-yaml',
  'apply-config',
  'port-forward-start',
  'port-forward-stop'
])
export type ActivityAction = z.infer<typeof ActivityActionSchema>

export const ActivityRecordSchema = z.object({
  id: z.string(),
  ts: z.number(), // ms since epoch — stamped by the main process
  clusterId: z.string(),
  clusterName: z.string(), // resolved by the main process from cluster-store
  action: ActivityActionSchema,
  kind: z.string().optional(), // resource kind, or 'nodes' for node ops
  namespace: z.string().optional(),
  name: z.string().optional(), // single target; omitted for a bulk summary
  count: z.number().int().positive().default(1), // >1 for a bulk summary
  outcome: ActivityOutcomeSchema,
  message: z.string().optional() // error text, or "3 ok, 2 failed" for partial bulk
})
export type ActivityRecord = z.infer<typeof ActivityRecordSchema>

/** What the renderer sends; the main process fills in id/ts/clusterName. */
export const ActivityInputSchema = ActivityRecordSchema.omit({
  id: true,
  ts: true,
  clusterName: true
})
export type ActivityInput = z.infer<typeof ActivityInputSchema>

export const ActivityRecordArraySchema = z.array(ActivityRecordSchema)
export const ActivityHistorySchema = z
  .object({ records: ActivityRecordArraySchema.default([]) })
  .catch({ records: [] })
export type ActivityHistory = z.infer<typeof ActivityHistorySchema>

/** One Helm release revision (decoded from its release Secret). */
export const HelmReleaseSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  revision: z.number(),
  chart: z.string(),
  chartVersion: z.string(),
  appVersion: z.string(),
  status: z.string(),
  updated: z.string()
})
export type HelmRelease = z.infer<typeof HelmReleaseSchema>
export const HelmReleaseArraySchema = z.array(HelmReleaseSchema)

/** The surface exposed on `window.api` by the preload bridge. Function
 *  signatures aren't `z.infer`-able, so this stays a plain interface that
 *  references the inferred data types above. */
export interface LightshipApi {
  clusters: {
    list(): Promise<ClusterMeta[]>
    detect(): Promise<DetectedContext[]>
    parse(yaml: string): Promise<DetectedContext[]>
    add(selections: ClusterAddSelection[]): Promise<ClusterMeta[]>
    remove(id: string): Promise<void>
    /** Rename a cluster's display name (kube context/kubeconfig untouched). */
    rename(id: string, name: string): Promise<void>
    /** Persist the cluster list order shown in the primary sidebar. */
    reorder(ids: ClusterOrder): Promise<ClusterMeta[]>
    test(id: string): Promise<TestResult>
  }
  cluster: {
    overview(id: string): Promise<ClusterOverview>
    overviewBundle(id: string): Promise<OverviewBundle>
    nodes(id: string): Promise<NodeRow[]>
    /** Full detail for one node (properties tab of the node detail view). */
    nodeDetail(id: string, name: string): Promise<NodeDetail>
    /** Recent events (newest first) — cluster-wide, or scoped to `ref` if given. */
    events(id: string, ref?: ResourceRef): Promise<ClusterEvent[]>
    pods(id: string): Promise<Pod[]>
    listResource(id: string, kind: string, namespace?: string): Promise<ResourceRow[]>
    /** Live instances of a CRD (dynamic GVK): the CRD's print columns + rows. */
    listCustomResource(id: string, params: CustomResourceParams): Promise<CustomResourceList>
    /** Installed Helm releases (latest revision each), decoded from release Secrets. */
    helmReleases(id: string): Promise<HelmRelease[]>
    /** All stored revisions of one Helm release (newest first). */
    helmRevisions(id: string, namespace: string, name: string): Promise<HelmRelease[]>

    deleteResource(id: string, ref: ResourceRef): Promise<void>
    rolloutRestart(id: string, ref: ResourceRef): Promise<void>
    /** Patch `spec.replicas` on a scalable workload (Deployment / StatefulSet). */
    scaleResource(id: string, ref: ResourceRef, replicas: ScaleReplicas): Promise<void>
    /** Mark a node unschedulable (`spec.unschedulable = true`). */
    cordon(id: string, name: string): Promise<void>
    /** Clear a node's unschedulable flag. */
    uncordon(id: string, name: string): Promise<void>
    /** Cordon a node, then evict its pods (skips DaemonSet/mirror/completed pods). */
    drain(id: string, name: string): Promise<void>
    /** The live manifest of a single resource, serialized to YAML. */
    getYaml(id: string, ref: ResourceRef): Promise<string>
    /** Apply an edited YAML manifest back to the cluster (kubectl-replace semantics). */
    applyYaml(id: string, ref: ResourceRef, yaml: string): Promise<void>
    /** Create a new resource from a manifest (POST). */
    createYaml(id: string, yaml: string): Promise<void>
    /** Live object fields (labels, and for pods containers/QoS/limits) for the Overview tab. */
    getResourceDetail(id: string, ref: ResourceRef): Promise<ResourceDetail>
    /** The decoded key/value data of a ConfigMap or Secret. */
    getConfigData(id: string, ref: ResourceRef): Promise<ConfigData>
    /** Replace the text data of a ConfigMap or Secret (binary keys preserved). */
    applyConfigData(id: string, ref: ResourceRef, data: Record<string, string>): Promise<void>
    /** Stream live logs for a pod (or every pod owned by a workload). Tail-follows
     *  in real time; returns an unsubscribe fn that stops the underlying streams. */
    streamLogs(
      id: string,
      ref: ResourceRef,
      opts: LogStreamOptions,
      onEvent: (ev: LogEvent) => void
    ): () => void
    /** Open an interactive shell scoped to the cluster's kube context (kubectl ready).
     *  Returns a handle to write input, resize, and kill the session. */
    openTerminal(id: string, opts: PtyOptions, onEvent: (ev: PtyEvent) => void): TerminalHandle
    /** Forward a local port to a resource (pod/service/workload → backing pod).
     *  Returns a handle to stop the forward. */
    startPortForward(
      id: string,
      ref: ResourceRef,
      opts: PortForwardOptions,
      onEvent: (ev: PortForwardEvent) => void
    ): PortForwardHandle
    /** Subscribe to live add/modified/deleted deltas for a resource kind, backed
     *  by a Kubernetes informer. Emits a `reset` snapshot on each (re)list, then
     *  incremental `deltas`, plus `status` events. Returns an unsubscribe fn that
     *  stops the underlying informer. */
    watch(id: string, kind: string, onEvent: (ev: WatchEvent) => void): () => void
  }
  uiState: {
    /** All persisted per-resource sub-tab selections, keyed by `detailTabKey`. */
    getDetailTabs(): Promise<Record<string, string>>
    /** Persist the active sub-tab for one resource (keyed by `detailTabKey`). */
    setDetailTab(key: string, tab: string): Promise<void>
  }
  activity: {
    /** Persist one mutating action; returns the stored record (id/ts/clusterName filled in). */
    record(input: ActivityInput): Promise<ActivityRecord>
    /** The full Activity history, newest first. */
    list(): Promise<ActivityRecord[]>
    /** Erase the Activity history. */
    clear(): Promise<void>
  }
  window: {
    /** Subscribe to the ⌘W accelerator; returns an unsubscribe fn. */
    onCloseTab(cb: () => void): () => void
    /** Close the current window. */
    close(): Promise<void>
    /** Open a localhost URL in the default browser (port-forward links). */
    openExternal(url: string): Promise<void>
  }
}
