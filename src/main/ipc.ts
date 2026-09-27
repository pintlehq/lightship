import { BrowserWindow, shell } from 'electron'
import { z } from 'zod'

import {
  ActivityInputSchema,
  ActivityRecordArraySchema,
  ActivityRecordSchema,
  ClusterAddSelectionArraySchema,
  ClusterEventArraySchema,
  ClusterMetaArraySchema,
  ClusterOrderSchema,
  ClusterOverviewSchema,
  ConfigDataSaveResultSchema,
  ConfigDataSchema,
  ConfigDataUpdateSchema,
  CustomResourceListSchema,
  CustomResourceParamsSchema,
  DetectedContextArraySchema,
  DrainResultSchema,
  HelmReleaseArraySchema,
  LogStreamOptionsSchema,
  NamespaceCreateInputSchema,
  NamespaceDetailSchema,
  NamespaceSummaryListSchema,
  NodeDetailSchema,
  NodeRowArraySchema,
  OverviewBundleSchema,
  PodArraySchema,
  PortForwardOptionsSchema,
  PtyOptionsSchema,
  ResourceDetailSchema,
  ResourceRefSchema,
  ResourceRowArraySchema,
  ScaleReplicasSchema,
  TestResultSchema
} from '../shared/ipc-types'
import { approvedExternalUrl } from './electron-boundary'
import { parseArgs, registerInvokeHandler } from './ipc-helpers'
import * as activity from './services/activity'
import * as connections from './services/cluster-connections'
import * as store from './services/cluster-store'
import * as configData from './services/config-data'
import * as events from './services/events'
import * as helm from './services/helm'
import * as client from './services/k8s-client'
import * as logs from './services/logs'
import * as namespaces from './services/namespaces'
import * as nodeDrain from './services/node-drain'
import * as nodes from './services/nodes'
import * as overview from './services/overview'
import * as portForward from './services/port-forward'
import * as pty from './services/pty'
import * as resourceDetail from './services/resource-detail'
import * as mutations from './services/resource-mutations'
import * as resources from './services/resources'
import * as uiState from './services/ui-state'
import * as watch from './services/watch'

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
    connections.detectKubeconfigContexts()
  )
  registerInvokeHandler(
    'clusters:parse',
    parseArgs(z.string()),
    DetectedContextArraySchema,
    (_e, yaml) => connections.parseKubeconfig(yaml)
  )
  registerInvokeHandler(
    'clusters:add',
    parseArgs(ClusterAddSelectionArraySchema),
    ClusterMetaArraySchema,
    (_e, selections) => connections.addClusters(selections)
  )
  registerInvokeHandler('clusters:remove', parseArgs(Id), z.void(), async (_e, clusterId) => {
    client.invalidate(clusterId)
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
    connections.testConnection(id)
  )

  registerInvokeHandler('cluster:overview', parseArgs(Id), ClusterOverviewSchema, (_e, id) =>
    overview.getOverview(id)
  )
  registerInvokeHandler('cluster:overviewBundle', parseArgs(Id), OverviewBundleSchema, (_e, id) =>
    overview.getOverviewBundle(id)
  )
  registerInvokeHandler('cluster:nodes', parseArgs(Id), NodeRowArraySchema, (_e, id) =>
    nodes.listNodes(id)
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
    nodes.getNodeDetail(id, name)
  )
  registerInvokeHandler(
    'cluster:events',
    parseArgs(Id, ResourceRefSchema.optional()),
    ClusterEventArraySchema,
    (_e, id, ref) => events.listEvents(id, ref)
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
    (_e, id, ref) => mutations.deleteResource(id, ref)
  )
  registerInvokeHandler(
    'cluster:rolloutRestart',
    parseArgs(Id, ResourceRefSchema),
    z.void(),
    (_e, id, ref) => mutations.rolloutRestart(id, ref)
  )
  registerInvokeHandler(
    'cluster:scaleResource',
    parseArgs(Id, ResourceRefSchema, ScaleReplicasSchema),
    z.void(),
    (_e, id, ref, replicas) => mutations.scaleResource(id, ref, replicas)
  )
  registerInvokeHandler('cluster:cordon', parseArgs(Id, Id), z.void(), (_e, id, name) =>
    mutations.cordonNode(id, name)
  )
  registerInvokeHandler('cluster:uncordon', parseArgs(Id, Id), z.void(), (_e, id, name) =>
    mutations.uncordonNode(id, name)
  )
  registerInvokeHandler(
    'cluster:drain',
    parseArgs(Id, Id, Id),
    DrainResultSchema,
    (e, subId, id, name) => nodeDrain.startDrain(e.sender, subId, id, name)
  )
  registerInvokeHandler('cluster:cancelDrain', parseArgs(Id), z.void(), (e, subId) =>
    nodeDrain.cancelDrain(e.sender, subId)
  )
  registerInvokeHandler(
    'cluster:getYaml',
    parseArgs(Id, ResourceRefSchema),
    z.string(),
    (_e, id, ref) => mutations.getYaml(id, ref)
  )
  registerInvokeHandler(
    'cluster:applyYaml',
    parseArgs(Id, ResourceRefSchema, z.string()),
    z.void(),
    (_e, id, ref, yaml) => mutations.applyYaml(id, ref, yaml)
  )
  registerInvokeHandler(
    'cluster:createYaml',
    parseArgs(Id, z.string()),
    ResourceRefSchema,
    (_e, id, yaml) => mutations.createYaml(id, yaml)
  )
  registerInvokeHandler(
    'cluster:getResourceDetail',
    parseArgs(Id, ResourceRefSchema),
    ResourceDetailSchema,
    (_e, id, ref) => resourceDetail.getResourceDetail(id, ref)
  )
  registerInvokeHandler(
    'cluster:getConfigData',
    parseArgs(Id, ResourceRefSchema),
    ConfigDataSchema,
    (_e, id, ref) => configData.getConfigData(id, ref)
  )
  registerInvokeHandler(
    'cluster:applyConfigData',
    parseArgs(Id, ResourceRefSchema, ConfigDataUpdateSchema),
    ConfigDataSaveResultSchema,
    (_e, id, ref, update) => configData.applyConfigData(id, ref, update)
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
  registerInvokeHandler('cluster:ptyInput', parseArgs(Id, z.string()), z.void(), (e, subId, data) =>
    pty.writePty(e.sender, subId, data)
  )
  registerInvokeHandler(
    'cluster:ptyResize',
    parseArgs(Id, z.number(), z.number()),
    z.void(),
    (e, subId, cols, rows) => pty.resizePty(e.sender, subId, cols, rows)
  )
  registerInvokeHandler('cluster:stopPty', parseArgs(Id), z.void(), (e, subId) =>
    pty.stopPty(e.sender, subId)
  )

  // Port-forward: start opens a local listener proxying to the resolved pod and
  // pushes status to `cluster:pf:<subId>`; stop tears it down.
  registerInvokeHandler(
    'cluster:startPortForward',
    parseArgs(Id, Id, ResourceRefSchema, PortForwardOptionsSchema),
    z.void(),
    (e, subId, id, ref, opts) => portForward.startPortForward(e.sender, subId, id, ref, opts)
  )
  registerInvokeHandler('cluster:stopPortForward', parseArgs(Id), z.void(), (e, subId) =>
    portForward.stopPortForward(e.sender, subId)
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
    return shell.openExternal(approvedExternalUrl(u))
  })
}
