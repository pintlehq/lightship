export interface ResourceCapabilities {
  /** Workloads whose pods can be resolved for log streaming. */
  loggable?: boolean
  /** Resources that can be used as a port-forward target. */
  forwardable?: boolean
  /** Workloads that support a rollout restart patch. */
  restartable?: boolean
  /** Workloads that support a replica count patch. */
  scalable?: boolean
}

export interface BuiltinResourceDefinition {
  apiVersion: string
  kind: string
  plural: string
  namespaced: boolean
  capabilities: ResourceCapabilities
}

/** Process-neutral metadata only. Kubernetes clients and UI presentation stay in their owners. */
export const RESOURCE_CATALOG = {
  namespaces: {
    apiVersion: 'v1',
    kind: 'Namespace',
    namespaced: false,
    plural: 'namespaces',
    capabilities: {}
  },
  pods: {
    apiVersion: 'v1',
    kind: 'Pod',
    namespaced: true,
    plural: 'pods',
    capabilities: {}
  },
  deployments: {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    namespaced: true,
    plural: 'deployments',
    capabilities: {
      loggable: true,
      forwardable: true,
      restartable: true,
      scalable: true
    }
  },
  statefulsets: {
    apiVersion: 'apps/v1',
    kind: 'StatefulSet',
    namespaced: true,
    plural: 'statefulsets',
    capabilities: {
      loggable: true,
      forwardable: true,
      restartable: true,
      scalable: true
    }
  },
  daemonsets: {
    apiVersion: 'apps/v1',
    kind: 'DaemonSet',
    namespaced: true,
    plural: 'daemonsets',
    capabilities: {
      loggable: true,
      forwardable: true,
      restartable: true
    }
  },
  jobs: {
    apiVersion: 'batch/v1',
    kind: 'Job',
    namespaced: true,
    plural: 'jobs',
    capabilities: {
      loggable: true,
      forwardable: true
    }
  },
  cronjobs: {
    apiVersion: 'batch/v1',
    kind: 'CronJob',
    namespaced: true,
    plural: 'cronjobs',
    capabilities: {
      loggable: true
    }
  },
  services: {
    apiVersion: 'v1',
    kind: 'Service',
    namespaced: true,
    plural: 'services',
    capabilities: {
      forwardable: true
    }
  },
  ingresses: {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    namespaced: true,
    plural: 'ingresses',
    capabilities: {}
  },
  endpoints: {
    apiVersion: 'v1',
    kind: 'Endpoints',
    namespaced: true,
    plural: 'endpoints',
    capabilities: {}
  },
  configmaps: {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    namespaced: true,
    plural: 'configmaps',
    capabilities: {}
  },
  secrets: {
    apiVersion: 'v1',
    kind: 'Secret',
    namespaced: true,
    plural: 'secrets',
    capabilities: {}
  },
  pvc: {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    namespaced: true,
    plural: 'persistentvolumeclaims',
    capabilities: {}
  },
  pv: {
    apiVersion: 'v1',
    kind: 'PersistentVolume',
    namespaced: false,
    plural: 'persistentvolumes',
    capabilities: {}
  },
  roles: {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    namespaced: true,
    plural: 'roles',
    capabilities: {}
  },
  rolebindings: {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    namespaced: true,
    plural: 'rolebindings',
    capabilities: {}
  },
  clusterroles: {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRole',
    namespaced: false,
    plural: 'clusterroles',
    capabilities: {}
  },
  clusterrolebindings: {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRoleBinding',
    namespaced: false,
    plural: 'clusterrolebindings',
    capabilities: {}
  },
  serviceaccounts: {
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    namespaced: true,
    plural: 'serviceaccounts',
    capabilities: {}
  },
  crd: {
    apiVersion: 'apiextensions.k8s.io/v1',
    kind: 'CustomResourceDefinition',
    namespaced: false,
    plural: 'customresourcedefinitions',
    capabilities: {}
  },
  nodes: {
    apiVersion: 'v1',
    kind: 'Node',
    namespaced: false,
    plural: 'nodes',
    capabilities: {}
  }
} as const satisfies Record<string, BuiltinResourceDefinition>

export type BuiltinResourceId = keyof typeof RESOURCE_CATALOG
/** Pods and nodes have dedicated row schemas and list/watch implementations. */
export type GenericResourceId = Exclude<BuiltinResourceId, 'pods' | 'nodes'>
/** Namespaces have a dedicated management screen instead of generic columns. */
export type ResourceListId = Exclude<GenericResourceId, 'namespaces'>

export function builtinResource(id: string): BuiltinResourceDefinition | undefined {
  return isBuiltinResourceId(id) ? RESOURCE_CATALOG[id] : undefined
}

export function isBuiltinResourceId(id: string): id is BuiltinResourceId {
  return Object.hasOwn(RESOURCE_CATALOG, id)
}

export function resourceCollectionPath(id: GenericResourceId): string {
  const { apiVersion, plural } = RESOURCE_CATALOG[id]
  return (apiVersion.includes('/') ? '/apis/' : '/api/') + apiVersion + '/' + plural
}
