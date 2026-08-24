import type { KubeConfig, KubernetesListObject, KubernetesObject } from '@kubernetes/client-node'

import { loadK8s } from './k8s'

export type WatchSpec = {
  path: string
  list: (kc: KubeConfig) => () => Promise<KubernetesListObject<KubernetesObject>>
  /** When set, the list path fetches the lightweight Kubernetes Table API. */
  table?: { columns: (cells: Record<string, string>) => Record<string, string> }
}

// Per-kind watch spec: the API path makeInformer watches + a listPromiseFn
// factory. Keys mirror RESOURCE_MAPPERS exactly.
export const WATCH_SPECS: Record<string, WatchSpec> = {
  deployments: {
    path: '/apis/apps/v1/deployments',
    list: (kc) => async () => {
      const { AppsV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(AppsV1Api)
        .listDeploymentForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  statefulsets: {
    path: '/apis/apps/v1/statefulsets',
    list: (kc) => async () => {
      const { AppsV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(AppsV1Api)
        .listStatefulSetForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  daemonsets: {
    path: '/apis/apps/v1/daemonsets',
    list: (kc) => async () => {
      const { AppsV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(AppsV1Api)
        .listDaemonSetForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  jobs: {
    path: '/apis/batch/v1/jobs',
    list: (kc) => async () => {
      const { BatchV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(BatchV1Api)
        .listJobForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  cronjobs: {
    path: '/apis/batch/v1/cronjobs',
    list: (kc) => async () => {
      const { BatchV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(BatchV1Api)
        .listCronJobForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  services: {
    path: '/api/v1/services',
    list: (kc) => async () => {
      const { CoreV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(CoreV1Api)
        .listServiceForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  ingresses: {
    path: '/apis/networking.k8s.io/v1/ingresses',
    list: (kc) => async () => {
      const { NetworkingV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(NetworkingV1Api)
        .listIngressForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  endpoints: {
    path: '/api/v1/endpoints',
    list: (kc) => async () => {
      const { CoreV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(CoreV1Api)
        .listEndpointsForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  configmaps: {
    path: '/api/v1/configmaps',
    list: (kc) => async () => {
      const { CoreV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(CoreV1Api)
        .listConfigMapForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    },
    table: { columns: (c) => ({ keys: c.data ?? '0' }) }
  },
  secrets: {
    path: '/api/v1/secrets',
    list: (kc) => async () => {
      const { CoreV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(CoreV1Api)
        .listSecretForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    },
    table: { columns: (c) => ({ type: c.type ?? '', keys: c.data ?? '0' }) }
  },
  pvc: {
    path: '/api/v1/persistentvolumeclaims',
    list: (kc) => async () => {
      const { CoreV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(CoreV1Api)
        .listPersistentVolumeClaimForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  pv: {
    path: '/api/v1/persistentvolumes',
    list: (kc) => async () => {
      const { CoreV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(CoreV1Api)
        .listPersistentVolume()) as KubernetesListObject<KubernetesObject>
    }
  },
  namespaces: {
    path: '/api/v1/namespaces',
    list: (kc) => async () => {
      const { CoreV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(CoreV1Api)
        .listNamespace()) as KubernetesListObject<KubernetesObject>
    }
  },
  roles: {
    path: '/apis/rbac.authorization.k8s.io/v1/roles',
    list: (kc) => async () => {
      const { RbacAuthorizationV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(RbacAuthorizationV1Api)
        .listRoleForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  rolebindings: {
    path: '/apis/rbac.authorization.k8s.io/v1/rolebindings',
    list: (kc) => async () => {
      const { RbacAuthorizationV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(RbacAuthorizationV1Api)
        .listRoleBindingForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  clusterroles: {
    path: '/apis/rbac.authorization.k8s.io/v1/clusterroles',
    list: (kc) => async () => {
      const { RbacAuthorizationV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(RbacAuthorizationV1Api)
        .listClusterRole()) as KubernetesListObject<KubernetesObject>
    }
  },
  clusterrolebindings: {
    path: '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings',
    list: (kc) => async () => {
      const { RbacAuthorizationV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(RbacAuthorizationV1Api)
        .listClusterRoleBinding()) as KubernetesListObject<KubernetesObject>
    }
  },
  serviceaccounts: {
    path: '/api/v1/serviceaccounts',
    list: (kc) => async () => {
      const { CoreV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(CoreV1Api)
        .listServiceAccountForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  crd: {
    path: '/apis/apiextensions.k8s.io/v1/customresourcedefinitions',
    list: (kc) => async () => {
      const { ApiextensionsV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(ApiextensionsV1Api)
        .listCustomResourceDefinition()) as KubernetesListObject<KubernetesObject>
    }
  }
}

export function isListableResource(kind: string): boolean {
  return kind in WATCH_SPECS
}
