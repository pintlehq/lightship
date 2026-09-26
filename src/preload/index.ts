import { contextBridge, ipcRenderer } from 'electron'

import type { LightshipApi, PortForwardEvent, PtyEvent } from '../shared/ipc-types'
import {
  createDrainOperation,
  createManagedSubscription,
  createSubscription,
  invoke
} from './ipc-helpers'

// Curated, typed surface exposed to the renderer as `window.api`.
const api: LightshipApi = {
  clusters: {
    list: () => invoke('clusters:list'),
    detect: () => invoke('clusters:detect'),
    parse: (yaml) => invoke('clusters:parse', yaml),
    add: (selections) => invoke('clusters:add', selections),
    remove: (id) => invoke('clusters:remove', id),
    rename: (id, name) => invoke('clusters:rename', id, name),
    reorder: (ids) => invoke('clusters:reorder', ids),
    test: (id) => invoke('clusters:test', id)
  },
  cluster: {
    overview: (id) => invoke('cluster:overview', id),
    overviewBundle: (id) => invoke('cluster:overviewBundle', id),
    nodes: (id) => invoke('cluster:nodes', id),
    namespaceSummaries: (id) => invoke('cluster:namespaceSummaries', id),
    namespaceDetail: (id, name) => invoke('cluster:namespaceDetail', id, name),
    createNamespace: (id, input) => invoke('cluster:createNamespace', id, input),
    deleteNamespace: (id, name) => invoke('cluster:deleteNamespace', id, name),
    nodeDetail: (id, name) => invoke('cluster:nodeDetail', id, name),
    events: (id, ref) => invoke('cluster:events', id, ref),
    pods: (id) => invoke('cluster:pods', id),
    listResource: (id, kind, namespace) => invoke('cluster:listResource', id, kind, namespace),
    listCustomResource: (id, params) => invoke('cluster:listCustomResource', id, params),
    helmReleases: (id) => invoke('cluster:helmReleases', id),
    helmRevisions: (id, namespace, name) => invoke('cluster:helmRevisions', id, namespace, name),
    deleteResource: (id, ref) => invoke('cluster:deleteResource', id, ref),
    rolloutRestart: (id, ref) => invoke('cluster:rolloutRestart', id, ref),
    scaleResource: (id, ref, replicas) => invoke('cluster:scaleResource', id, ref, replicas),
    cordon: (id, name) => invoke('cluster:cordon', id, name),
    uncordon: (id, name) => invoke('cluster:uncordon', id, name),
    drain: createDrainOperation,
    getYaml: (id, ref) => invoke('cluster:getYaml', id, ref),
    applyYaml: (id, ref, yaml) => invoke('cluster:applyYaml', id, ref, yaml),
    createYaml: (id, yaml) => invoke('cluster:createYaml', id, yaml),
    getResourceDetail: (id, ref) => invoke('cluster:getResourceDetail', id, ref),
    getConfigData: (id, ref) => invoke('cluster:getConfigData', id, ref),
    applyConfigData: (id, ref, data) => invoke('cluster:applyConfigData', id, ref, data),
    streamLogs: (id, ref, opts, onEvent) => {
      const subId = `logs:${globalThis.crypto.randomUUID()}`
      // Subscribe before starting so no early lines are dropped.
      return createSubscription({
        subId,
        eventPrefix: 'cluster:logs',
        startChannel: 'cluster:startLogs',
        stopChannel: 'cluster:stopLogs',
        startArgs: [id, ref, opts],
        onEvent
      })
    },
    openTerminal: (id, opts, onEvent) => {
      const session = createManagedSubscription<PtyEvent>({
        prefix: 'pty',
        eventPrefix: 'cluster:pty',
        startChannel: 'cluster:startPty',
        stopChannel: 'cluster:stopPty',
        startArgs: [id, opts],
        onEvent,
        errorEvent: (message) => ({ type: 'error', message })
      })
      return {
        write: (data) =>
          void invoke('cluster:ptyInput', session.subId, data).catch(session.reportError),
        resize: (cols, rows) =>
          void invoke('cluster:ptyResize', session.subId, cols, rows).catch(session.reportError),
        kill: session.stop
      }
    },
    startPortForward: (id, ref, opts, onEvent) => {
      const session = createManagedSubscription<PortForwardEvent>({
        prefix: 'pf',
        eventPrefix: 'cluster:pf',
        startChannel: 'cluster:startPortForward',
        stopChannel: 'cluster:stopPortForward',
        startArgs: [id, ref, opts],
        onEvent,
        errorEvent: (message) => ({ type: 'error', message })
      })
      return {
        stop: session.stop
      }
    },
    watch: (id, kind, onEvent) => {
      const subId = `watch:${globalThis.crypto.randomUUID()}`
      return createSubscription({
        subId,
        eventPrefix: 'cluster:watch',
        startChannel: 'cluster:startWatch',
        stopChannel: 'cluster:stopWatch',
        startArgs: [id, kind],
        onEvent
      })
    }
  },
  uiState: {
    getDetailTabs: () => invoke('uiState:getDetailTabs'),
    setDetailTab: (key, tab) => invoke('uiState:setDetailTab', key, tab)
  },
  activity: {
    record: (input) => invoke('activity:record', input),
    list: () => invoke('activity:list'),
    clear: () => invoke('activity:clear')
  },
  window: {
    onCloseTab: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on('shortcut:close-tab', listener)
      return () => ipcRenderer.removeListener('shortcut:close-tab', listener)
    },
    close: () => invoke('window:close'),
    openExternal: (url) => invoke('window:openExternal', url)
  }
}

contextBridge.exposeInMainWorld('api', api)
