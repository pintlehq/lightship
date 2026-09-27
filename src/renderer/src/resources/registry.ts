import { RESOURCE_CATALOG, type ResourceListId } from '../../../shared/resource-catalog'
// Describes how each sidebar resource id is listed + which columns to show.
// Column `key`s must match the main-process mappers in services/resource-mappers.ts.

import { resourceCapabilities } from '../../../shared/resource-capabilities'

export interface ResourceColumn {
  key: string
  header: string
  align?: 'left' | 'right' | 'center'
}

export interface ResourceDescriptor {
  id: string
  label: string
  namespaced: boolean
  columns: ResourceColumn[]
  /** Pod-owning workloads expose a Logs tab in the detail view. */
  loggable?: boolean
  /** Resources that can be port-forwarded (services + pod-owning workloads). */
  forwardable?: boolean
}

const RESOURCE_DESCRIPTORS: Record<
  ResourceListId,
  Pick<ResourceDescriptor, 'label' | 'columns'>
> = {
  deployments: {
    label: 'Deployments',
    columns: [
      { key: 'ready', header: 'READY' },
      { key: 'up-to-date', header: 'UP-TO-DATE', align: 'right' },
      { key: 'available', header: 'AVAILABLE', align: 'right' }
    ]
  },
  statefulsets: {
    label: 'StatefulSets',
    columns: [{ key: 'ready', header: 'READY' }]
  },
  daemonsets: {
    label: 'DaemonSets',
    columns: [
      { key: 'ready', header: 'READY' },
      { key: 'up-to-date', header: 'UP-TO-DATE', align: 'right' },
      { key: 'available', header: 'AVAILABLE', align: 'right' }
    ]
  },
  jobs: {
    label: 'Jobs',
    columns: [
      { key: 'completions', header: 'COMPLETIONS' },
      { key: 'status', header: 'STATUS' }
    ]
  },
  cronjobs: {
    label: 'CronJobs',
    columns: [
      { key: 'schedule', header: 'SCHEDULE' },
      { key: 'suspend', header: 'SUSPEND' },
      { key: 'last schedule', header: 'LAST SCHEDULE' }
    ]
  },
  services: {
    label: 'Services',
    columns: [
      { key: 'type', header: 'TYPE' },
      { key: 'cluster-ip', header: 'CLUSTER-IP' },
      { key: 'ports', header: 'PORTS' }
    ]
  },
  ingresses: {
    label: 'Ingresses',
    columns: [
      { key: 'class', header: 'CLASS' },
      { key: 'hosts', header: 'HOSTS' }
    ]
  },
  endpoints: {
    label: 'Endpoints',
    columns: [{ key: 'endpoints', header: 'ENDPOINTS', align: 'right' }]
  },
  configmaps: {
    label: 'ConfigMaps',
    columns: [{ key: 'keys', header: 'KEYS', align: 'right' }]
  },
  secrets: {
    label: 'Secrets',
    columns: [
      { key: 'type', header: 'TYPE' },
      { key: 'keys', header: 'KEYS', align: 'right' }
    ]
  },
  pvc: {
    label: 'PersistentVolumeClaims',
    columns: [
      { key: 'status', header: 'STATUS' },
      { key: 'capacity', header: 'CAPACITY', align: 'right' },
      { key: 'storage-class', header: 'STORAGE CLASS' },
      { key: 'volume', header: 'VOLUME' }
    ]
  },
  pv: {
    label: 'PersistentVolumes',
    columns: [
      { key: 'status', header: 'STATUS' },
      { key: 'capacity', header: 'CAPACITY', align: 'right' },
      { key: 'claim', header: 'CLAIM' },
      { key: 'storage-class', header: 'STORAGE CLASS' }
    ]
  },
  roles: {
    label: 'Roles',
    columns: [{ key: 'rules', header: 'RULES', align: 'right' }]
  },
  rolebindings: {
    label: 'RoleBindings',
    columns: [
      { key: 'role', header: 'ROLE' },
      { key: 'subjects', header: 'SUBJECTS', align: 'right' }
    ]
  },
  clusterroles: {
    label: 'ClusterRoles',
    columns: [{ key: 'rules', header: 'RULES', align: 'right' }]
  },
  clusterrolebindings: {
    label: 'ClusterRoleBindings',
    columns: [
      { key: 'role', header: 'ROLE' },
      { key: 'subjects', header: 'SUBJECTS', align: 'right' }
    ]
  },
  serviceaccounts: {
    label: 'ServiceAccounts',
    columns: [{ key: 'secrets', header: 'SECRETS', align: 'right' }]
  },
  crd: {
    label: 'Custom Resources',
    columns: [
      { key: 'group', header: 'GROUP' },
      { key: 'kind', header: 'KIND' },
      { key: 'scope', header: 'SCOPE' },
      { key: 'versions', header: 'VERSIONS' }
    ]
  }
}

export const RESOURCE_REGISTRY: Record<string, ResourceDescriptor> = Object.fromEntries(
  (Object.keys(RESOURCE_DESCRIPTORS) as ResourceListId[]).map((id) => [
    id,
    {
      id,
      ...RESOURCE_DESCRIPTORS[id],
      namespaced: RESOURCE_CATALOG[id].namespaced,
      ...resourceCapabilities(id)
    }
  ])
) as Record<string, ResourceDescriptor>

export const isResourceId = (id: string): boolean => Object.hasOwn(RESOURCE_REGISTRY, id)
