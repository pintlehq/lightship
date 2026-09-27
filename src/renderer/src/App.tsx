import { Toaster } from '@renderer/ui/components/toaster'
import { usePaletteHotkey } from '@renderer/ui/hooks/use-palette-hotkey'
import type { PaletteGroup } from '@renderer/ui/lib/types'
import { AppShell } from '@renderer/ui/shell/app-shell'
import { CommandPalette } from '@renderer/ui/shell/command-palette'
import { SettingsDialog } from '@renderer/ui/shell/settings-dialog'
import { StatusSeg } from '@renderer/ui/shell/statusbar'
import { useThemeStore } from '@renderer/ui/stores/theme-store'
import { Fragment } from 'react'
import { useAppBootstrap } from './app/use-app-bootstrap'
import { useAppNavigation } from './app/use-app-navigation'

import { useClusters } from './queries/clusters'
import { useOverview } from './queries/overview'
import { useTabsStore } from './stores/tabs-store'
import { useTerminalsStore } from './stores/terminals-store'
import { useUiStore } from './stores/ui-store'
import { AddClusterModal } from './views/add-cluster-modal'
import { renderLightshipView } from './views/render-lightship-view'
import { LightshipSidebar } from './views/sidebar/lightship-sidebar'
import { TerminalPanel } from './views/terminal-panel'

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

  useAppBootstrap(tabs)
  const {
    selectNav,
    onOpenPod,
    onOpenNode,
    onOpenNamespace,
    onOpenNamespacedResource,
    onOpenCrdInstance,
    onOpenCrdKind,
    onOpenResource,
    onOpenRelease,
    onOpenLogs,
    onOpenWorkloadLogs,
    onExec
  } = useAppNavigation(clusters)

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
          icon: 'folder',
          label: 'Namespaces',
          hint: 'namespace management',
          onSelect: () =>
            fallbackCluster && selectNav('namespaces', 'Namespaces', fallbackCluster.id)
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
      <Fragment key={active?.id}>
        {renderLightshipView({
          view,
          activeTabId: active?.id ?? null,
          onAddCluster: () => ui.setAddClusterOpen(true),
          onOpenPod,
          onOpenLogs,
          onExec,
          onOpenNode,
          onOpenNamespace,
          onOpenNamespacedResource,
          onOpenResource,
          onOpenWorkloadLogs,
          onOpenCrdInstance,
          onOpenRelease
        })}
      </Fragment>
    </AppShell>
  )
}

export default App
