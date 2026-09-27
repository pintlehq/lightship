import type { KubeConfig, KubernetesListObject, KubernetesObject } from '@kubernetes/client-node'
import { resourceCollectionPath, type GenericResourceId } from '../../shared/resource-catalog'

import { loadK8s } from './k8s-client'

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
    path: resourceCollectionPath('deployments'),
    list: (kc) => async () => {
      const { AppsV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(AppsV1Api)
        .listDeploymentForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  statefulsets: {
    path: resourceCollectionPath('statefulsets'),
    list: (kc) => async () => {
      const { AppsV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(AppsV1Api)
        .listStatefulSetForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  daemonsets: {
    path: resourceCollectionPath('daemonsets'),
    list: (kc) => async () => {
      const { AppsV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(AppsV1Api)
        .listDaemonSetForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  jobs: {
    path: resourceCollectionPath('jobs'),
    list: (kc) => async () => {
      const { BatchV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(BatchV1Api)
        .listJobForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  cronjobs: {
    path: resourceCollectionPath('cronjobs'),
    list: (kc) => async () => {
      const { BatchV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(BatchV1Api)
        .listCronJobForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  services: {
    path: resourceCollectionPath('services'),
    list: (kc) => async () => {
      const { CoreV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(CoreV1Api)
        .listServiceForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  ingresses: {
    path: resourceCollectionPath('ingresses'),
    list: (kc) => async () => {
      const { NetworkingV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(NetworkingV1Api)
        .listIngressForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  endpoints: {
    path: resourceCollectionPath('endpoints'),
    list: (kc) => async () => {
      const { CoreV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(CoreV1Api)
        .listEndpointsForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  configmaps: {
    path: resourceCollectionPath('configmaps'),
    list: (kc) => async () => {
      const { CoreV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(CoreV1Api)
        .listConfigMapForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    },
    table: { columns: (c) => ({ keys: c.data ?? '0' }) }
  },
  secrets: {
    path: resourceCollectionPath('secrets'),
    list: (kc) => async () => {
      const { CoreV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(CoreV1Api)
        .listSecretForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    },
    table: { columns: (c) => ({ type: c.type ?? '', keys: c.data ?? '0' }) }
  },
  pvc: {
    path: resourceCollectionPath('pvc'),
    list: (kc) => async () => {
      const { CoreV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(CoreV1Api)
        .listPersistentVolumeClaimForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  pv: {
    path: resourceCollectionPath('pv'),
    list: (kc) => async () => {
      const { CoreV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(CoreV1Api)
        .listPersistentVolume()) as KubernetesListObject<KubernetesObject>
    }
  },
  namespaces: {
    path: resourceCollectionPath('namespaces'),
    list: (kc) => async () => {
      const { CoreV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(CoreV1Api)
        .listNamespace()) as KubernetesListObject<KubernetesObject>
    }
  },
  roles: {
    path: resourceCollectionPath('roles'),
    list: (kc) => async () => {
      const { RbacAuthorizationV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(RbacAuthorizationV1Api)
        .listRoleForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  rolebindings: {
    path: resourceCollectionPath('rolebindings'),
    list: (kc) => async () => {
      const { RbacAuthorizationV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(RbacAuthorizationV1Api)
        .listRoleBindingForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  clusterroles: {
    path: resourceCollectionPath('clusterroles'),
    list: (kc) => async () => {
      const { RbacAuthorizationV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(RbacAuthorizationV1Api)
        .listClusterRole()) as KubernetesListObject<KubernetesObject>
    }
  },
  clusterrolebindings: {
    path: resourceCollectionPath('clusterrolebindings'),
    list: (kc) => async () => {
      const { RbacAuthorizationV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(RbacAuthorizationV1Api)
        .listClusterRoleBinding()) as KubernetesListObject<KubernetesObject>
    }
  },
  serviceaccounts: {
    path: resourceCollectionPath('serviceaccounts'),
    list: (kc) => async () => {
      const { CoreV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(CoreV1Api)
        .listServiceAccountForAllNamespaces()) as KubernetesListObject<KubernetesObject>
    }
  },
  crd: {
    path: resourceCollectionPath('crd'),
    list: (kc) => async () => {
      const { ApiextensionsV1Api } = await loadK8s()
      return (await kc
        .makeApiClient(ApiextensionsV1Api)
        .listCustomResourceDefinition()) as KubernetesListObject<KubernetesObject>
    }
  }
} satisfies Record<GenericResourceId, WatchSpec>

export function isListableResource(kind: string): boolean {
  return kind in WATCH_SPECS
}
