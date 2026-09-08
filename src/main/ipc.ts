import { BrowserWindow, shell } from 'electron'
import { z } from 'zod'

import {
  ClusterAddSelectionArraySchema,
  ClusterEventArraySchema,
  ClusterMetaArraySchema,
  ClusterOverviewSchema,
  ClusterOrderSchema,
  OverviewBundleSchema,
  ActivityInputSchema,
  ActivityRecordArraySchema,
  ActivityRecordSchema,
  ConfigDataSchema,
  CustomResourceListSchema,
  CustomResourceParamsSchema,
  DetectedContextArraySchema,
  HelmReleaseArraySchema,
  LogStreamOptionsSchema,
  PortForwardOptionsSchema,
  PtyOptionsSchema,
  ResourceDetailSchema,
  NodeDetailSchema,
  NodeRowArraySchema,
  NamespaceCreateInputSchema,
  NamespaceDetailSchema,
  NamespaceSummaryListSchema,
  PodArraySchema,
  ResourceRefSchema,
  ResourceRowArraySchema,
  ScaleReplicasSchema,
  TestResultSchema
} from '../shared/ipc-types'
import * as activity from './services/activity'
import * as store from './services/cluster-store'
import * as k8s from './services/k8s'
import * as logs from './services/logs'
import * as namespaces from './services/namespaces'
import * as portForward from './services/port-forward'
import * as helm from './services/helm'
import * as pty from './services/pty'
import * as resources from './services/resources'
import * as uiState from './services/ui-state'
import * as watch from './services/watch'
import { parseArgs, registerInvokeHandler } from './ipc-helpers'

// Renderer-supplied arguments are untrusted — parse them before use. A failed
// parse rejects the IPC call, which the renderer already handles.
const Id = z.string().min(1)
const OptStr = z.string().optional()

/** Registers all Lightship IPC handlers. Call once after `app.whenReady()`. */
export function registerLightshipIpc(): void {
  // Inputs are validated with `.parse` (throws → IPC rejects); outputs — the
  // mapped Kubernetes DTOs — are validated before they cross back to the renderer.
  registerInvokeHandler('clusters:list', parseArgs(), ClusterMetaArraySchema, () =>
    store.listClusters()
  )
  registerInvokeHandler('clusters:detect', parseArgs(), DetectedContextArraySchema, () =>
    k8s.detectKubeconfigContexts()
  )
  registerInvokeHandler(
    'clusters:parse',
    parseArgs(z.string()),
    DetectedContextArraySchema,
    (_e, yaml) => k8s.parseKubeconfig(yaml)
  )
  registerInvokeHandler(
    'clusters:add',
    parseArgs(ClusterAddSelectionArraySchema),
    ClusterMetaArraySchema,
    (_e, selections) => k8s.addClusters(selections)
  )
  registerInvokeHandler('clusters:remove', parseArgs(Id), z.void(), async (_e, clusterId) => {
    k8s.invalidate(clusterId)
    await store.removeCluster(clusterId)
  })
  registerInvokeHandler(
    'clusters:rename',
    parseArgs(Id, z.string().min(1)),
    z.void(),
    (_e, id, name) => store.renameCluster(id, name)
  )
  registerInvokeHandler(
    'clusters:reorder',
    parseArgs(ClusterOrderSchema),
    ClusterMetaArraySchema,
    (_e, ids) => store.reorderClusters(ids)
  )
  registerInvokeHandler('clusters:test', parseArgs(Id), TestResultSchema, (_e, id) =>
    k8s.testConnection(id)
  )

  registerInvokeHandler('cluster:overview', parseArgs(Id), ClusterOverviewSchema, (_e, id) =>
    k8s.getOverview(id)
  )
  registerInvokeHandler('cluster:overviewBundle', parseArgs(Id), OverviewBundleSchema, (_e, id) =>
    k8s.getOverviewBundle(id)
  )
  registerInvokeHandler('cluster:nodes', parseArgs(Id), NodeRowArraySchema, (_e, id) =>
    k8s.listNodes(id)
  )
  registerInvokeHandler(
    'cluster:namespaceSummaries',
    parseArgs(Id),
    NamespaceSummaryListSchema,
    (_e, id) => namespaces.listNamespaceSummaries(id)
  )
  registerInvokeHandler(
    'cluster:namespaceDetail',
    parseArgs(Id, Id),
    NamespaceDetailSchema,
    (_e, id, name) => namespaces.getNamespaceDetail(id, name)
  )
  registerInvokeHandler(
    'cluster:createNamespace',
    parseArgs(Id, NamespaceCreateInputSchema),
    z.void(),
    (_e, id, input) => namespaces.createNamespace(id, input)
  )
  registerInvokeHandler('cluster:deleteNamespace', parseArgs(Id, Id), z.void(), (_e, id, name) =>
    namespaces.deleteNamespace(id, name)
  )
  registerInvokeHandler('cluster:nodeDetail', parseArgs(Id, Id), NodeDetailSchema, (_e, id, name) =>
    k8s.getNodeDetail(id, name)
  )
  registerInvokeHandler(
    'cluster:events',
    parseArgs(Id, ResourceRefSchema.optional()),
    ClusterEventArraySchema,
    (_e, id, ref) => k8s.listEvents(id, ref)
  )
  registerInvokeHandler(
    'cluster:listResource',
    parseArgs(Id, Id, OptStr),
    ResourceRowArraySchema,
    (_e, id, kind, ns) => resources.listResource(id, kind, ns)
  )
  registerInvokeHandler('cluster:pods', parseArgs(Id), PodArraySchema, (_e, id) =>
    resources.listPods(id)
  )
  registerInvokeHandler(
    'cluster:listCustomResource',
    parseArgs(Id, CustomResourceParamsSchema),
    CustomResourceListSchema,
    (_e, id, params) => resources.listCustomResource(id, params)
  )
  registerInvokeHandler('cluster:helmReleases', parseArgs(Id), HelmReleaseArraySchema, (_e, id) =>
    helm.listHelmReleases(id)
  )
  registerInvokeHandler(
    'cluster:helmRevisions',
    parseArgs(Id, Id, Id),
    HelmReleaseArraySchema,
    (_e, id, ns, name) => helm.listHelmRevisions(id, ns, name)
  )
  registerInvokeHandler(
    'cluster:deleteResource',
    parseArgs(Id, ResourceRefSchema),
    z.void(),
    (_e, id, ref) => resources.deleteResource(id, ref)
  )
  registerInvokeHandler(
    'cluster:rolloutRestart',
    parseArgs(Id, ResourceRefSchema),
    z.void(),
    (_e, id, ref) => resources.rolloutRestart(id, ref)
  )
  registerInvokeHandler(
    'cluster:scaleResource',
    parseArgs(Id, ResourceRefSchema, ScaleReplicasSchema),
    z.void(),
    (_e, id, ref, replicas) => resources.scaleResource(id, ref, replicas)
  )
  registerInvokeHandler('cluster:cordon', parseArgs(Id, Id), z.void(), (_e, id, name) =>
    resources.cordonNode(id, name)
  )
  registerInvokeHandler('cluster:uncordon', parseArgs(Id, Id), z.void(), (_e, id, name) =>
    resources.uncordonNode(id, name)
  )
  registerInvokeHandler('cluster:drain', parseArgs(Id, Id), z.void(), (_e, id, name) =>
    resources.drainNode(id, name)
  )
  registerInvokeHandler(
    'cluster:getYaml',
    parseArgs(Id, ResourceRefSchema),
    z.string(),
    (_e, id, ref) => resources.getYaml(id, ref)
  )
  registerInvokeHandler(
    'cluster:applyYaml',
    parseArgs(Id, ResourceRefSchema, z.string()),
    z.void(),
    (_e, id, ref, yaml) => resources.applyYaml(id, ref, yaml)
  )
  registerInvokeHandler('cluster:createYaml', parseArgs(Id, z.string()), z.void(), (_e, id, yaml) =>
    resources.createYaml(id, yaml)
  )
  registerInvokeHandler(
    'cluster:getResourceDetail',
    parseArgs(Id, ResourceRefSchema),
    ResourceDetailSchema,
    (_e, id, ref) => resources.getResourceDetail(id, ref)
  )
  registerInvokeHandler(
    'cluster:getConfigData',
    parseArgs(Id, ResourceRefSchema),
    ConfigDataSchema,
    (_e, id, ref) => resources.getConfigData(id, ref)
  )
  registerInvokeHandler(
    'cluster:applyConfigData',
    parseArgs(Id, ResourceRefSchema, z.record(z.string(), z.string())),
    z.void(),
    (_e, id, ref, data) => resources.applyConfigData(id, ref, data)
  )

  // Live log streaming: start opens follow-streams that push to
  // `cluster:logs:<subId>`; stop aborts them. The renderer owns the subId.
  registerInvokeHandler(
    'cluster:startLogs',
    parseArgs(Id, Id, ResourceRefSchema, LogStreamOptionsSchema),
    z.void(),
    (e, subId, id, ref, opts) => logs.startLogStream(e.sender, subId, id, ref, opts)
  )
  registerInvokeHandler('cluster:stopLogs', parseArgs(Id), z.void(), (_e, subId) =>
    logs.stopLogStream(subId)
  )

  // Interactive terminal (node-pty): start spawns a shell scoped to the cluster
  // and pushes output to `cluster:pty:<subId>`; input/resize/stop act on the subId.
  registerInvokeHandler(
    'cluster:startPty',
    parseArgs(Id, Id, PtyOptionsSchema),
    z.void(),
    (e, subId, id, opts) => pty.startPty(e.sender, subId, id, opts)
  )
  registerInvokeHandler(
    'cluster:ptyInput',
    parseArgs(Id, z.string()),
    z.void(),
    (_e, subId, data) => pty.writePty(subId, data)
  )
  registerInvokeHandler(
    'cluster:ptyResize',
    parseArgs(Id, z.number(), z.number()),
    z.void(),
    (_e, subId, cols, rows) => pty.resizePty(subId, cols, rows)
  )
  registerInvokeHandler('cluster:stopPty', parseArgs(Id), z.void(), (_e, subId) =>
    pty.stopPty(subId)
  )

  // Port-forward: start opens a local listener proxying to the resolved pod and
  // pushes status to `cluster:pf:<subId>`; stop tears it down.
  registerInvokeHandler(
    'cluster:startPortForward',
    parseArgs(Id, Id, ResourceRefSchema, PortForwardOptionsSchema),
    z.void(),
    (e, subId, id, ref, opts) => portForward.startPortForward(e.sender, subId, id, ref, opts)
  )
  registerInvokeHandler('cluster:stopPortForward', parseArgs(Id), z.void(), (_e, subId) =>
    portForward.stopPortForward(subId)
  )

  // Live updates: start opens a per-kind informer that pushes reset/deltas/status
  // to `cluster:watch:<subId>`; stop tears it down. The renderer owns the subId.
  registerInvokeHandler(
    'cluster:startWatch',
    parseArgs(Id, Id, Id),
    z.void(),
    (e, subId, id, kind) => watch.startWatch(e.sender, subId, id, kind)
  )
  registerInvokeHandler('cluster:stopWatch', parseArgs(Id), z.void(), (_e, subId) =>
    watch.stopWatch(subId)
  )

  // Persisted renderer UI state (non-sensitive; lightship-data/configs/preferences.json).
  registerInvokeHandler(
    'uiState:getDetailTabs',
    parseArgs(),
    z.record(z.string(), z.string()),
    async () => (await uiState.readUiState()).detailTabs
  )
  registerInvokeHandler('uiState:setDetailTab', parseArgs(Id, Id), z.void(), (_e, key, tab) =>
    uiState.setDetailTab(key, tab)
  )

  // Global Activity history (non-sensitive; lightship-data/history/activity.json).
  registerInvokeHandler(
    'activity:record',
    parseArgs(ActivityInputSchema),
    ActivityRecordSchema,
    (_e, input) => activity.recordActivity(input)
  )
  registerInvokeHandler('activity:list', parseArgs(), ActivityRecordArraySchema, () =>
    activity.readActivity()
  )
  registerInvokeHandler('activity:clear', parseArgs(), z.void(), () => activity.clearActivity())

  registerInvokeHandler('window:close', parseArgs(), z.void(), (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
  })
  registerInvokeHandler('window:openExternal', parseArgs(z.string()), z.void(), (_e, u) => {
    if (!/^https?:\/\/(localhost|127\.0\.0\.1):\d+/.test(u))
      throw new Error('Refusing to open non-localhost URL')
    return shell.openExternal(u)
  })
}
