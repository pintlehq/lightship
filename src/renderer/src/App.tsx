import { useEffect } from 'react'
import { usePaletteHotkey } from '@renderer/ui/hooks/use-palette-hotkey'
import { AppShell } from '@renderer/ui/shell/app-shell'
import { CommandPalette } from '@renderer/ui/shell/command-palette'
import { SettingsDialog } from '@renderer/ui/shell/settings-dialog'
import { StatusSeg } from '@renderer/ui/shell/statusbar'
import { Toaster } from '@renderer/ui/components/toaster'
import type { PaletteGroup } from '@renderer/ui/lib/types'
import { useThemeStore } from '@renderer/ui/stores/theme-store'

import type { CrdLeaf } from './lib/crd-tree'
import { lightshipNavTab, navIconFor } from './lib/lightship-navigation'
import { useClusters, useOverview } from './queries/use-lightship-data'
import { useActivityStore } from './stores/activity-store'
import { useDetailTabStore } from './stores/detail-tab-store'
import { useNamespaceFilterStore } from './stores/namespace-filter-store'
import { useTabsStore } from './stores/tabs-store'
import { useTerminalsStore } from './stores/terminals-store'
import { useUiStore } from './stores/ui-store'
import type { CustomResourceColumn, HelmRelease } from '../../shared/ipc-types'
import type { LightshipView, NodeRow, Pod, ResourceRow } from './types'
import { LightshipSidebar } from './views/sidebar/lightship-sidebar'
import { AddClusterModal } from './views/add-cluster-modal'
import { TerminalPanel } from './views/terminal-panel'
import { renderLightshipView } from './views/render-lightship-view'

function App() {
  const {
    tabs,
    activeTab,
    openTab,
    closeTab,
    closeOthers,
    closeToRight,
    closeAll,
    reorderTabs,
    selectTab
  } = useTabsStore()
  const ui = useUiStore()
  const seedNs = useNamespaceFilterStore((s) => s.seed)
  const pruneNs = useNamespaceFilterStore((s) => s.pruneTo)
  const toggleTheme = useThemeStore((s) => s.toggle)

  // Live status-bar data.
  const { data: clusters = [] } = useClusters()
  const active = tabs.find((t) => t.id === activeTab) ?? null
  const view = active?.view ?? null
  // Cluster context follows the active tab; cluster-agnostic tabs (history, manage
  // clusters, port-forwards) have none → status bar reads "No cluster".
  const activeClusterId = view && 'clusterId' in view ? view.clusterId : null
  const clusterName = clusters.find((c) => c.id === activeClusterId)?.name
  const { data: ov } = useOverview(activeClusterId)
  // Cluster for cluster-agnostic actions (new terminal, palette nav): the active
  // tab's cluster, else the first connected cluster.
  const fallbackCluster = clusters.find((c) => c.id === activeClusterId) ?? clusters[0]
  const termCount = useTerminalsStore((s) => s.sessions.length)
  usePaletteHotkey(ui.togglePalette)

  // Keep per-tab namespace filters in sync with open tabs: drop entries for tabs
  // that were closed so a reopened tab inherits the current last-applied filter.
  useEffect(() => {
    pruneNs(tabs.map((t) => t.id))
  }, [tabs, pruneNs])

  // Load persisted per-resource sub-tab selections once at startup. Cheap local
  // file read; resolves long before the user opens any resource detail (tabs
  // don't persist, so nothing is mounted at cold start).
  useEffect(() => {
    void useDetailTabStore.getState().hydrate()
    void useActivityStore.getState().hydrate()
  }, [])

  // ⌘W closes the focused terminal session first; else the active tab; once no
  // tabs remain it closes the window.
  useEffect(() => {
    return window.api?.window?.onCloseTab(() => {
      const term = useTerminalsStore.getState()
      if (term.focused && term.activeId) {
        term.closeSession(term.activeId)
        return
      }
      const { activeTab, closeTab } = useTabsStore.getState()
      if (activeTab) closeTab(activeTab)
      else void window.api.window.close()
    })
  }, [])

  const selectNav = (id: string, label: string, clusterId: string) => {
    const { seedNamespaceFilter, ...tab } = lightshipNavTab(id, label, clusterId)
    // Pin the last-applied namespace filter onto namespaced tabs as they open, so
    // each open tab stays independent when the filter later changes elsewhere.
    if (seedNamespaceFilter) seedNs(tab.id)
    openTab(tab)
  }

  const onOpenPod = (clusterId: string, pod: Pod) =>
    openTab({
      id: `pod:${clusterId}:${pod.name}`,
      label: `${pod.name.split('-')[0]}·pod`,
      icon: 'box',
      view: { kind: 'pod', clusterId, pod }
    })

  const onOpenNode = (clusterId: string, node: NodeRow) =>
    openTab({
      id: `node:${clusterId}:${node.name}`,
      label: `${node.name}·node`,
      icon: 'server',
      view: { kind: 'node-detail', clusterId, node }
    })

  // Open one CRD's live-instances browser. Shared by the CRD list row and the
  // sidebar's grouped Custom Resources tree so both open the identical tab.
  const openCrdInstances = (
    clusterId: string,
    meta: {
      name: string
      kind: string
      group: string
      version: string
      plural: string
      namespaced: boolean
    }
  ) => {
    const label = meta.kind || meta.name
    openTab({
      id: `crd:${clusterId}:${meta.name}`,
      label,
      icon: 'code',
      view: {
        kind: 'crd-instances',
        clusterId,
        group: meta.group,
        version: meta.version,
        plural: meta.plural,
        namespaced: meta.namespaced,
        crdKind: meta.kind,
        label
      }
    })
  }

  // Open one custom-resource instance's detail (Properties + YAML + Events).
  const onOpenCrdInstance = (
    view: Extract<LightshipView, { kind: 'crd-instances' }>,
    columns: CustomResourceColumn[],
    row: ResourceRow
  ) => {
    openTab({
      id: `crd-detail:${view.clusterId}:${view.group}/${view.version}/${view.plural}:${row.namespace ?? ''}:${row.name}`,
      label: row.name,
      icon: 'code',
      view: {
        kind: 'crd-instance-detail',
        clusterId: view.clusterId,
        group: view.group,
        version: view.version,
        plural: view.plural,
        namespaced: view.namespaced,
        crdKind: view.crdKind,
        columns,
        row,
        label: row.name
      }
    })
  }

  const onOpenCrdKind = (clusterId: string, leaf: CrdLeaf) => openCrdInstances(clusterId, leaf)

  const onOpenResource = (clusterId: string, resourceId: string, row: ResourceRow) => {
    // A CRD row opens a browser of that CRD's live instances (not a YAML detail).
    if (resourceId === 'crd') {
      const c = row.columns
      openCrdInstances(clusterId, {
        name: row.name,
        kind: c.kind ?? '',
        group: c.group ?? '',
        version: c.version ?? '',
        plural: c.plural ?? '',
        namespaced: c.scope === 'Namespaced'
      })
      return
    }
    openTab({
      id: `${clusterId}:${resourceId}:${row.uid}`,
      label: row.name,
      icon: navIconFor(resourceId),
      view: { kind: 'resource-detail', clusterId, resourceId, label: row.name, row }
    })
  }

  const onOpenRelease = (clusterId: string, r: HelmRelease) =>
    openTab({
      id: `helm:${clusterId}:${r.namespace}/${r.name}`,
      label: `${r.name}·helm`,
      icon: 'zap',
      view: { kind: 'helm-release', clusterId, namespace: r.namespace, name: r.name, label: r.name }
    })

  // Logs: a multiplexed pane streaming the given pods, optionally one container.
  const onOpenLogs = (clusterId: string, pods: Pod[], container?: string) => {
    if (pods.length === 0) return
    const refs = pods.map((p) => ({ kind: 'pods', namespace: p.ns, name: p.name }))
    const podKeys = pods
      .map((p) => `${p.ns}/${p.name}`)
      .sort()
      .join(',')
    const id = `logs:${clusterId}:${podKeys}${container ? `/${container}` : ''}`
    const base = pods.length === 1 ? pods[0].name.split('-')[0] : `${pods.length} pods`
    const label = `${base}${container ? `/${container}` : ''}·logs`
    openTab({ id, label, icon: 'file', view: { kind: 'logs', clusterId, refs, label, container } })
  }

  // Logs from a workload row — the backend resolves the workload to its pods.
  const onOpenWorkloadLogs = (clusterId: string, resourceId: string, row: ResourceRow) => {
    const ref = { kind: resourceId, namespace: row.namespace, name: row.name }
    const id = `logs:${clusterId}:${resourceId}/${row.namespace ?? ''}/${row.name}`
    const label = `${row.name}·logs`
    openTab({ id, label, icon: 'file', view: { kind: 'logs', clusterId, refs: [ref], label } })
  }

  // Exec: open a kubectl-exec terminal into a pod's container, in its tab's cluster.
  const onExec = (clusterId: string, pod: Pod, container?: string) => {
    const cl = clusters.find((c) => c.id === clusterId)
    if (!cl) return
    useTerminalsStore.getState().newSession({
      clusterId: cl.id,
      clusterName: cl.name,
      namespace: pod.ns,
      pod: pod.name,
      container,
      title: container ? `${pod.name}/${container}` : pod.name
    })
    ui.setShowTerminal(true)
  }

  const paletteGroups: PaletteGroup[] = [
    {
      group: 'Navigate',
      items: [
        {
          icon: 'activity',
          label: 'Overview',
          hint: 'cluster dashboard',
          onSelect: () => fallbackCluster && selectNav('overview', 'Overview', fallbackCluster.id)
        },
        {
          icon: 'box',
          label: 'Pods',
          hint: '42 in checkout',
          onSelect: () => fallbackCluster && selectNav('pods', 'Pods', fallbackCluster.id)
        },
        {
          icon: 'server',
          label: 'Nodes',
          hint: '12 nodes',
          onSelect: () => fallbackCluster && selectNav('nodes', 'Nodes', fallbackCluster.id)
        },
        {
          icon: 'zap',
          label: 'Helm Releases',
          onSelect: () => fallbackCluster && selectNav('helm', 'Helm Releases', fallbackCluster.id)
        }
      ]
    },
    {
      group: 'Actions',
      items: [
        {
          icon: 'terminal',
          label: 'Open terminal',
          kbd: ['⌃', '`'],
          onSelect: () => ui.setShowTerminal(true)
        },
        { icon: 'refresh', label: 'Refresh resources', kbd: ['⌘', 'R'] },
        { icon: 'sun', label: 'Toggle theme', kbd: ['⌘', '⇧', 'L'], onSelect: toggleTheme },
        { icon: 'settings', label: 'Open settings', onSelect: () => ui.setSettingsOpen(true) }
      ]
    }
  ]

  return (
    <AppShell
      paletteHint="search clusters, resources, actions…"
      onPalette={() => ui.setPaletteOpen(true)}
      onSettings={() => ui.setSettingsOpen(true)}
      onHistory={() =>
        openTab({ id: 'history', label: 'History', icon: 'history', view: { kind: 'history' } })
      }
      sidebar={
        <LightshipSidebar
          active={activeTab ?? ''}
          activeClusterId={activeClusterId}
          onSelect={(cid, id, label) => selectNav(id, label, cid)}
          onOpenCrdKind={onOpenCrdKind}
          onAddCluster={() => ui.setAddClusterOpen(true)}
          onManageClusters={() =>
            openTab({
              id: 'clusters',
              label: 'Manage clusters',
              icon: 'layers',
              view: { kind: 'clusters' }
            })
          }
          onNewTerminal={(cl) => {
            useTerminalsStore.getState().newSession({ clusterId: cl.id, clusterName: cl.name })
            ui.setShowTerminal(true)
          }}
        />
      }
      tabs={tabs}
      activeTab={activeTab}
      onSelectTab={selectTab}
      onCloseTab={closeTab}
      onCloseOtherTabs={closeOthers}
      onCloseTabsToRight={closeToRight}
      onCloseAllTabs={closeAll}
      onReorderTab={reorderTabs}
      tabbarActions={[
        { icon: 'terminal', label: 'Terminal', active: ui.showTerminal, onClick: ui.toggleTerminal }
      ]}
      bottomPanel={
        ui.showTerminal ? (
          <TerminalPanel
            activeCluster={fallbackCluster}
            onClose={() => ui.setShowTerminal(false)}
          />
        ) : undefined
      }
      statusLeft={
        <>
          <StatusSeg icon="server" tone="primary">
            {clusterName ?? 'No cluster'}
          </StatusSeg>
          {activeClusterId && ov && (
            <StatusSeg>
              {ov.nodesReady}/{ov.nodes} nodes
            </StatusSeg>
          )}
          {activeClusterId && ov && <StatusSeg>{ov.pods} pods</StatusSeg>}
          {activeClusterId && ov && <StatusSeg>{ov.namespaces} ns</StatusSeg>}
        </>
      }
      statusRight={
        <>
          {activeClusterId && ov?.cpuPct != null && (
            <StatusSeg tone={ov.cpuPct >= 80 ? 'warning' : undefined}>CPU {ov.cpuPct}%</StatusSeg>
          )}
          {activeClusterId && ov?.memPct != null && (
            <StatusSeg tone={ov.memPct >= 80 ? 'warning' : undefined}>MEM {ov.memPct}%</StatusSeg>
          )}
          {termCount > 0 && (
            <StatusSeg icon="terminal">
              {termCount} terminal{termCount > 1 ? 's' : ''}
            </StatusSeg>
          )}
          {ui.liveStatus !== 'idle' && (
            <StatusSeg
              icon="activity"
              tone={
                ui.liveStatus === 'connected'
                  ? 'success'
                  : ui.liveStatus === 'error'
                    ? 'destructive'
                    : undefined
              }
            >
              {ui.liveStatus === 'connected'
                ? 'live'
                : ui.liveStatus === 'error'
                  ? 'reconnecting'
                  : 'connecting'}
            </StatusSeg>
          )}
          <StatusSeg>{tabs.length} tabs</StatusSeg>
          <StatusSeg
            icon={ui.readOnly ? 'lock' : 'check'}
            tone={ui.readOnly ? 'destructive' : 'success'}
            onClick={ui.toggleReadOnly}
          >
            {ui.readOnly ? 'read-only' : 'read-write'}
          </StatusSeg>
        </>
      }
      overlays={
        <>
          <Toaster />
          <CommandPalette
            open={ui.paletteOpen}
            onClose={() => ui.setPaletteOpen(false)}
            placeholder="Type a command or search resources…"
            groups={paletteGroups}
          />
          <SettingsDialog
            open={ui.settingsOpen}
            onClose={() => ui.setSettingsOpen(false)}
            product="Lightship"
          />
          <AddClusterModal open={ui.addClusterOpen} onClose={() => ui.setAddClusterOpen(false)} />
        </>
      }
    >
      {renderLightshipView({
        view,
        activeTabId: active?.id ?? null,
        onAddCluster: () => ui.setAddClusterOpen(true),
        onOpenPod,
        onOpenLogs,
        onExec,
        onOpenNode,
        onOpenResource,
        onOpenWorkloadLogs,
        onOpenCrdInstance,
        onOpenRelease
      })}
    </AppShell>
  )
}

export default App
