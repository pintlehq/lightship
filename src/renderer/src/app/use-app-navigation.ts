import { resourceTabId } from '../lib/resource-identity'

import type { HelmRelease } from '../../../shared/ipc-types'
import type { CrdLeaf } from '../lib/crd-tree'
import { lightshipNavTab, navIconFor } from '../lib/lightship-navigation'
import { useClusterNavigation } from '../queries/cluster-connection'
import { useNamespaceFilterStore } from '../stores/namespace-filter-store'
import { useTabsStore } from '../stores/tabs-store'
import { useTerminalsStore } from '../stores/terminals-store'
import { useUiStore } from '../stores/ui-store'
import type { LightshipView, NodeRow, Pod, ResourceRow } from '../types'

import type { ClusterMeta } from '../../../shared/ipc-types'

export function useAppNavigation(clusters: ClusterMeta[]) {
  const openTab = useTabsStore((s) => s.openTab)
  const seedNs = useNamespaceFilterStore((s) => s.seed)
  const setScopedNs = useNamespaceFilterStore((s) => s.setScoped)
  const navigateCluster = useClusterNavigation()
  const setShowTerminal = useUiStore((s) => s.setShowTerminal)
  const selectNav = (id: string, label: string, clusterId: string) => {
    const { seedNamespaceFilter, ...tab } = lightshipNavTab(id, label, clusterId)
    if (!('clusterId' in tab.view)) {
      openTab(tab)
      return
    }
    navigateCluster(clusterId, clusters.find((c) => c.id === clusterId)?.name ?? clusterId, () => {
      // Pin the last-applied namespace filter onto namespaced tabs as they open.
      if (seedNamespaceFilter) seedNs(tab.id)
      openTab(tab)
    })
  }

  const onOpenPod = (clusterId: string, pod: Pod) =>
    openTab({
      id: resourceTabId(clusterId, { kind: 'pods', namespace: pod.ns, name: pod.name }),
      label: `${pod.name.split('-')[0]}·pod`,
      icon: 'box',
      view: { kind: 'pod', clusterId, namespace: pod.ns, name: pod.name }
    })

  const onOpenNode = (clusterId: string, node: NodeRow) =>
    openTab({
      id: resourceTabId(clusterId, { kind: 'nodes', name: node.name }),
      label: `${node.name}·node`,
      icon: 'server',
      view: { kind: 'node-detail', clusterId, name: node.name }
    })

  const onOpenNamespace = (clusterId: string, name: string) =>
    openTab({
      id: `namespace:${clusterId}:${name}`,
      label: `${name}·namespace`,
      icon: 'folder',
      view: { kind: 'namespace-detail', clusterId, name }
    })

  const onOpenNamespacedResource = (
    clusterId: string,
    resourceId: string,
    label: string,
    namespace: string
  ) => {
    const { seedNamespaceFilter: _seed, ...tab } = lightshipNavTab(resourceId, label, clusterId)
    setScopedNs(tab.id, [namespace])
    openTab(tab)
  }

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
    row: ResourceRow
  ) => {
    openTab({
      id: resourceTabId(view.clusterId, {
        kind: view.crdKind,
        apiVersion: `${view.group}/${view.version}`,
        namespace: row.namespace,
        name: row.name
      }),
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
        namespace: row.namespace,
        name: row.name,
        label: row.name
      }
    })
  }

  const onOpenCrdKind = (clusterId: string, leaf: CrdLeaf) =>
    navigateCluster(clusterId, clusters.find((c) => c.id === clusterId)?.name ?? clusterId, () =>
      openCrdInstances(clusterId, leaf)
    )

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
      id: resourceTabId(clusterId, { kind: resourceId, namespace: row.namespace, name: row.name }),
      label: row.name,
      icon: navIconFor(resourceId),
      view: {
        kind: 'resource-detail',
        clusterId,
        resourceId,
        label: row.name,
        namespace: row.namespace,
        name: row.name
      }
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
    setShowTerminal(true)
  }

  return {
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
  }
}
