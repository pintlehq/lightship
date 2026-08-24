import type { ReactNode } from 'react'
import { EmptyState } from '@renderer/ui/shell/empty-state'

import type { CustomResourceColumn, HelmRelease } from '../../../shared/ipc-types'
import type { LightshipView, NodeRow, Pod, ResourceRow } from '../types'
import { CrdInstanceDetailView } from './crd-instance-detail-view'
import { CrdInstancesView } from './crd-instances-view'
import { GenericView } from './generic-view'
import { LightshipHistoryView } from './lightship-history-view'
import { HelmReleaseView } from './helm-release-view'
import { HelmView } from './helm-view'
import { LogsPane } from './logs-pane'
import { ManageClustersView } from './manage-clusters-view'
import { NodeDetailView } from './node-detail-view'
import { NodesView } from './nodes-view'
import { OverviewView } from './overview-view'
import { PodDetailView } from './pod-detail-view'
import { PodsView } from './pods-view'
import { PortForwardsView } from './port-forwards-view'
import { ResourceDetailView } from './resource-detail-view'
import { ResourceListView } from './resource-list-view'

type CrdInstancesViewState = Extract<LightshipView, { kind: 'crd-instances' }>

export function renderLightshipView({
  view,
  activeTabId,
  onAddCluster,
  onOpenPod,
  onOpenLogs,
  onExec,
  onOpenNode,
  onOpenResource,
  onOpenWorkloadLogs,
  onOpenCrdInstance,
  onOpenRelease
}: {
  view: LightshipView | null
  activeTabId: string | null
  onAddCluster: () => void
  onOpenPod: (clusterId: string, pod: Pod) => void
  onOpenLogs: (clusterId: string, pods: Pod[], container?: string) => void
  onExec: (clusterId: string, pod: Pod, container?: string) => void
  onOpenNode: (clusterId: string, node: NodeRow) => void
  onOpenResource: (clusterId: string, resourceId: string, row: ResourceRow) => void
  onOpenWorkloadLogs: (clusterId: string, resourceId: string, row: ResourceRow) => void
  onOpenCrdInstance: (
    view: CrdInstancesViewState,
    columns: CustomResourceColumn[],
    row: ResourceRow
  ) => void
  onOpenRelease: (clusterId: string, release: HelmRelease) => void
}): ReactNode {
  if (!view) return <EmptyState />

  switch (view.kind) {
    case 'overview':
      return <OverviewView clusterId={view.clusterId} />
    case 'pods':
      return (
        <PodsView
          clusterId={view.clusterId}
          onOpenPod={(pod) => onOpenPod(view.clusterId, pod)}
          onOpenLogs={(pods, container) => onOpenLogs(view.clusterId, pods, container)}
          onExec={(pod, container) => onExec(view.clusterId, pod, container)}
          tabId={activeTabId ?? ''}
        />
      )
    case 'nodes':
      return (
        <NodesView
          clusterId={view.clusterId}
          onOpenNode={(node) => onOpenNode(view.clusterId, node)}
        />
      )
    case 'node-detail':
      return <NodeDetailView clusterId={view.clusterId} node={view.node} />
    case 'pod':
      return <PodDetailView clusterId={view.clusterId} pod={view.pod} />
    case 'clusters':
      return <ManageClustersView onAdd={onAddCluster} />
    case 'history':
      return <LightshipHistoryView />
    case 'port-forwards':
      return <PortForwardsView />
    case 'resource':
      return (
        <ResourceListView
          clusterId={view.clusterId}
          resourceId={view.resourceId}
          label={view.label}
          tabId={activeTabId ?? ''}
          onOpenRow={(row) => onOpenResource(view.clusterId, view.resourceId, row)}
          onOpenLogs={(row) => onOpenWorkloadLogs(view.clusterId, view.resourceId, row)}
        />
      )
    case 'resource-detail':
      return (
        <ResourceDetailView
          clusterId={view.clusterId}
          resourceId={view.resourceId}
          label={view.label}
          row={view.row}
        />
      )
    case 'logs':
      return <LogsPane clusterId={view.clusterId} refs={view.refs} container={view.container} />
    case 'crd-instances':
      return (
        <CrdInstancesView
          clusterId={view.clusterId}
          group={view.group}
          version={view.version}
          plural={view.plural}
          namespaced={view.namespaced}
          label={view.label}
          onOpenRow={(row, columns) => onOpenCrdInstance(view, columns, row)}
        />
      )
    case 'crd-instance-detail':
      return (
        <CrdInstanceDetailView
          clusterId={view.clusterId}
          group={view.group}
          version={view.version}
          plural={view.plural}
          namespaced={view.namespaced}
          crdKind={view.crdKind}
          columns={view.columns}
          row={view.row}
        />
      )
    case 'helm':
      return (
        <HelmView
          clusterId={view.clusterId}
          onOpenRelease={(r) => onOpenRelease(view.clusterId, r)}
        />
      )
    case 'helm-release':
      return (
        <HelmReleaseView
          clusterId={view.clusterId}
          namespace={view.namespace}
          name={view.name}
          label={view.label}
        />
      )
    case 'generic':
      return <GenericView label={view.label} />
    default:
      return <EmptyState />
  }
}
