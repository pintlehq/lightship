import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

import type { LightshipApi } from '../shared/ipc-types'
import { createSubscription, invoke } from './ipc-helpers'

// Per-renderer counters for unique subscription ids.
let logSeq = 0
let ptySeq = 0
let pfSeq = 0
let watchSeq = 0

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
    drain: (id, name) => invoke('cluster:drain', id, name),
    getYaml: (id, ref) => invoke('cluster:getYaml', id, ref),
    applyYaml: (id, ref, yaml) => invoke('cluster:applyYaml', id, ref, yaml),
    createYaml: (id, yaml) => invoke('cluster:createYaml', id, yaml),
    getResourceDetail: (id, ref) => invoke('cluster:getResourceDetail', id, ref),
    getConfigData: (id, ref) => invoke('cluster:getConfigData', id, ref),
    applyConfigData: (id, ref, data) => invoke('cluster:applyConfigData', id, ref, data),
    streamLogs: (id, ref, opts, onEvent) => {
      const subId = `logs:${++logSeq}`
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
      const subId = `pty:${++ptySeq}`
      const stop = createSubscription({
        subId,
        eventPrefix: 'cluster:pty',
        startChannel: 'cluster:startPty',
        stopChannel: 'cluster:stopPty',
        startArgs: [id, opts],
        onEvent
      })
      return {
        write: (data) => void invoke('cluster:ptyInput', subId, data),
        resize: (cols, rows) => void invoke('cluster:ptyResize', subId, cols, rows),
        kill: stop
      }
    },
    startPortForward: (id, ref, opts, onEvent) => {
      const subId = `pf:${++pfSeq}`
      const stop = createSubscription({
        subId,
        eventPrefix: 'cluster:pf',
        startChannel: 'cluster:startPortForward',
        stopChannel: 'cluster:stopPortForward',
        startArgs: [id, ref, opts],
        onEvent
      })
      return {
        stop
      }
    },
    watch: (id, kind, onEvent) => {
      const subId = `watch:${++watchSeq}`
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

// Use `contextBridge` APIs to expose Electron APIs to renderer only if
// context isolation is enabled, otherwise just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
