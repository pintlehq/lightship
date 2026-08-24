// Describes how each sidebar resource id is listed + which columns to show.
// Column `key`s must match the main-process mappers in services/resources.ts.

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

const RESOURCE_DESCRIPTORS: Record<string, Omit<ResourceDescriptor, 'loggable' | 'forwardable'>> = {
  deployments: {
    id: 'deployments',
    label: 'Deployments',
    namespaced: true,
    columns: [
      { key: 'ready', header: 'READY' },
      { key: 'up-to-date', header: 'UP-TO-DATE', align: 'right' },
      { key: 'available', header: 'AVAILABLE', align: 'right' }
    ]
  },
  statefulsets: {
    id: 'statefulsets',
    label: 'StatefulSets',
    namespaced: true,
    columns: [{ key: 'ready', header: 'READY' }]
  },
  daemonsets: {
    id: 'daemonsets',
    label: 'DaemonSets',
    namespaced: true,
    columns: [
      { key: 'ready', header: 'READY' },
      { key: 'up-to-date', header: 'UP-TO-DATE', align: 'right' },
      { key: 'available', header: 'AVAILABLE', align: 'right' }
    ]
  },
  jobs: {
    id: 'jobs',
    label: 'Jobs',
    namespaced: true,
    columns: [
      { key: 'completions', header: 'COMPLETIONS' },
      { key: 'status', header: 'STATUS' }
    ]
  },
  cronjobs: {
    id: 'cronjobs',
    label: 'CronJobs',
    namespaced: true,
    columns: [
      { key: 'schedule', header: 'SCHEDULE' },
      { key: 'suspend', header: 'SUSPEND' },
      { key: 'last schedule', header: 'LAST SCHEDULE' }
    ]
  },
  services: {
    id: 'services',
    label: 'Services',
    namespaced: true,
    columns: [
      { key: 'type', header: 'TYPE' },
      { key: 'cluster-ip', header: 'CLUSTER-IP' },
      { key: 'ports', header: 'PORTS' }
    ]
  },
  ingresses: {
    id: 'ingresses',
    label: 'Ingresses',
    namespaced: true,
    columns: [
      { key: 'class', header: 'CLASS' },
      { key: 'hosts', header: 'HOSTS' }
    ]
  },
  endpoints: {
    id: 'endpoints',
    label: 'Endpoints',
    namespaced: true,
    columns: [{ key: 'endpoints', header: 'ENDPOINTS', align: 'right' }]
  },
  configmaps: {
    id: 'configmaps',
    label: 'ConfigMaps',
    namespaced: true,
    columns: [{ key: 'keys', header: 'KEYS', align: 'right' }]
  },
  secrets: {
    id: 'secrets',
    label: 'Secrets',
    namespaced: true,
    columns: [
      { key: 'type', header: 'TYPE' },
      { key: 'keys', header: 'KEYS', align: 'right' }
    ]
  },
  pvc: {
    id: 'pvc',
    label: 'PersistentVolumeClaims',
    namespaced: true,
    columns: [
      { key: 'status', header: 'STATUS' },
      { key: 'capacity', header: 'CAPACITY', align: 'right' },
      { key: 'storage-class', header: 'STORAGE CLASS' },
      { key: 'volume', header: 'VOLUME' }
    ]
  },
  pv: {
    id: 'pv',
    label: 'PersistentVolumes',
    namespaced: false,
    columns: [
      { key: 'status', header: 'STATUS' },
      { key: 'capacity', header: 'CAPACITY', align: 'right' },
      { key: 'claim', header: 'CLAIM' },
      { key: 'storage-class', header: 'STORAGE CLASS' }
    ]
  },
  roles: {
    id: 'roles',
    label: 'Roles',
    namespaced: true,
    columns: [{ key: 'rules', header: 'RULES', align: 'right' }]
  },
  rolebindings: {
    id: 'rolebindings',
    label: 'RoleBindings',
    namespaced: true,
    columns: [
      { key: 'role', header: 'ROLE' },
      { key: 'subjects', header: 'SUBJECTS', align: 'right' }
    ]
  },
  clusterroles: {
    id: 'clusterroles',
    label: 'ClusterRoles',
    namespaced: false,
    columns: [{ key: 'rules', header: 'RULES', align: 'right' }]
  },
  clusterrolebindings: {
    id: 'clusterrolebindings',
    label: 'ClusterRoleBindings',
    namespaced: false,
    columns: [
      { key: 'role', header: 'ROLE' },
      { key: 'subjects', header: 'SUBJECTS', align: 'right' }
    ]
  },
  serviceaccounts: {
    id: 'serviceaccounts',
    label: 'ServiceAccounts',
    namespaced: true,
    columns: [{ key: 'secrets', header: 'SECRETS', align: 'right' }]
  },
  crd: {
    id: 'crd',
    label: 'Custom Resources',
    namespaced: false,
    columns: [
      { key: 'group', header: 'GROUP' },
      { key: 'kind', header: 'KIND' },
      { key: 'scope', header: 'SCOPE' },
      { key: 'versions', header: 'VERSIONS' }
    ]
  }
}

export const RESOURCE_REGISTRY: Record<string, ResourceDescriptor> = Object.fromEntries(
  Object.entries(RESOURCE_DESCRIPTORS).map(([id, desc]) => [
    id,
    { ...desc, ...resourceCapabilities(id) }
  ])
) as Record<string, ResourceDescriptor>

export const isResourceId = (id: string): boolean => id in RESOURCE_REGISTRY
