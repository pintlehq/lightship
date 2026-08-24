import type { ResourceRef } from '../../shared/ipc-types'

export const GVK: Record<string, { apiVersion: string; kind: string; namespaced: boolean }> = {
  pods: { apiVersion: 'v1', kind: 'Pod', namespaced: true },
  deployments: { apiVersion: 'apps/v1', kind: 'Deployment', namespaced: true },
  statefulsets: { apiVersion: 'apps/v1', kind: 'StatefulSet', namespaced: true },
  daemonsets: { apiVersion: 'apps/v1', kind: 'DaemonSet', namespaced: true },
  jobs: { apiVersion: 'batch/v1', kind: 'Job', namespaced: true },
  cronjobs: { apiVersion: 'batch/v1', kind: 'CronJob', namespaced: true },
  services: { apiVersion: 'v1', kind: 'Service', namespaced: true },
  ingresses: { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', namespaced: true },
  endpoints: { apiVersion: 'v1', kind: 'Endpoints', namespaced: true },
  configmaps: { apiVersion: 'v1', kind: 'ConfigMap', namespaced: true },
  secrets: { apiVersion: 'v1', kind: 'Secret', namespaced: true },
  pvc: { apiVersion: 'v1', kind: 'PersistentVolumeClaim', namespaced: true },
  pv: { apiVersion: 'v1', kind: 'PersistentVolume', namespaced: false },
  roles: { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', namespaced: true },
  rolebindings: {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    namespaced: true
  },
  clusterroles: {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRole',
    namespaced: false
  },
  clusterrolebindings: {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRoleBinding',
    namespaced: false
  },
  serviceaccounts: { apiVersion: 'v1', kind: 'ServiceAccount', namespaced: true },
  crd: {
    apiVersion: 'apiextensions.k8s.io/v1',
    kind: 'CustomResourceDefinition',
    namespaced: false
  }
}

/** Resolve a ref to a GVK: the static table for built-in kinds, else the ref's own
 * `apiVersion`/`kind` for custom-resource instances. */
export function resolveGvk(
  ref: ResourceRef
): { apiVersion: string; kind: string; namespaced: boolean } | undefined {
  return (
    GVK[ref.kind] ??
    (ref.apiVersion
      ? { apiVersion: ref.apiVersion, kind: ref.kind, namespaced: ref.namespace != null }
      : undefined)
  )
}
