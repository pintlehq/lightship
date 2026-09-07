import type { IconName } from '@renderer/ui/components/icon'

import { isResourceId, RESOURCE_REGISTRY } from '../resources/registry'
import type { LightshipView } from '../types'
import { navTabId } from './tab-id'

export const NAV_ICON: Record<string, IconName> = {
  overview: 'activity',
  pods: 'box',
  nodes: 'server',
  namespaces: 'folder',
  events: 'bell',
  helm: 'zap',
  rbac: 'shield',
  roles: 'shield',
  rolebindings: 'shield',
  clusterroles: 'shield',
  clusterrolebindings: 'shield',
  serviceaccounts: 'key',
  deployments: 'layers',
  statefulsets: 'layers',
  daemonsets: 'layers',
  jobs: 'workflow',
  cronjobs: 'history',
  services: 'network',
  ingresses: 'link',
  endpoints: 'network',
  configmaps: 'file',
  secrets: 'key',
  pv: 'hardDrive',
  pvc: 'hardDrive',
  'port-forwards': 'arrowRight'
}

export function navIconFor(id: string): IconName {
  return NAV_ICON[id] ?? 'box'
}

export function lightshipViewForNav(id: string, label: string, clusterId: string): LightshipView {
  if (id === 'overview') return { kind: 'overview', clusterId }
  if (id === 'pods') return { kind: 'pods', clusterId }
  if (id === 'nodes') return { kind: 'nodes', clusterId }
  if (id === 'namespaces') return { kind: 'namespaces', clusterId }
  if (id === 'port-forwards') return { kind: 'port-forwards' }
  if (id === 'helm') return { kind: 'helm', clusterId }
  if (isResourceId(id)) return { kind: 'resource', clusterId, resourceId: id, label }
  return { kind: 'generic', label }
}

export function shouldSeedNamespaceFilter(id: string): boolean {
  return id === 'pods' || (isResourceId(id) && RESOURCE_REGISTRY[id].namespaced)
}

export function lightshipNavTab(id: string, label: string, clusterId: string) {
  return {
    id: navTabId(clusterId, id),
    label,
    icon: navIconFor(id),
    view: lightshipViewForNav(id, label, clusterId),
    seedNamespaceFilter: shouldSeedNamespaceFilter(id)
  }
}
