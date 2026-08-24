import type {
  KubernetesObject,
  V1ClusterRole,
  V1ClusterRoleBinding,
  V1ConfigMap,
  V1CronJob,
  V1CustomResourceDefinition,
  V1DaemonSet,
  V1Deployment,
  V1Endpoints,
  V1Ingress,
  V1Job,
  V1Namespace,
  V1PersistentVolume,
  V1PersistentVolumeClaim,
  V1Pod,
  V1Role,
  V1RoleBinding,
  V1Secret,
  V1Service,
  V1ServiceAccount,
  V1StatefulSet
} from '@kubernetes/client-node'

import type { Pod, ResourceRow } from '../../shared/ipc-types'
import { ageOf } from './k8s'

export type Meta = {
  uid?: string
  namespace?: string
  name?: string
  creationTimestamp?: Date | string
}

export function base(meta?: Meta): Omit<ResourceRow, 'columns'> {
  return {
    uid: meta?.uid ?? `${meta?.namespace ?? ''}/${meta?.name ?? ''}`,
    namespace: meta?.namespace,
    name: meta?.name ?? '',
    age: ageOf(meta?.creationTimestamp)
  }
}

// Per-kind mappers: a single Kubernetes object -> the ResourceRow shape the
// renderer table expects. Column keys must match the renderer resource registry.
export const RESOURCE_MAPPERS: Record<string, (o: KubernetesObject) => ResourceRow> = {
  deployments: (o) => {
    const d = o as V1Deployment
    return {
      ...base(d.metadata),
      columns: {
        ready: `${d.status?.availableReplicas ?? 0}/${d.spec?.replicas ?? 0}`,
        'up-to-date': String(d.status?.updatedReplicas ?? 0),
        available: String(d.status?.availableReplicas ?? 0)
      }
    }
  },
  statefulsets: (o) => {
    const s = o as V1StatefulSet
    return {
      ...base(s.metadata),
      columns: { ready: `${s.status?.readyReplicas ?? 0}/${s.spec?.replicas ?? 0}` }
    }
  },
  daemonsets: (o) => {
    const d = o as V1DaemonSet
    return {
      ...base(d.metadata),
      columns: {
        ready: `${d.status?.numberReady ?? 0}/${d.status?.desiredNumberScheduled ?? 0}`,
        'up-to-date': String(d.status?.updatedNumberScheduled ?? 0),
        available: String(d.status?.numberAvailable ?? 0)
      }
    }
  },
  jobs: (o) => {
    const j = o as V1Job
    const conds = j.status?.conditions ?? []
    const status =
      conds.find((c) => c.status === 'True')?.type ?? (j.status?.active ? 'Active' : 'Pending')
    return {
      ...base(j.metadata),
      columns: {
        completions: `${j.status?.succeeded ?? 0}/${j.spec?.completions ?? 1}`,
        status
      }
    }
  },
  cronjobs: (o) => {
    const c = o as V1CronJob
    return {
      ...base(c.metadata),
      columns: {
        schedule: c.spec?.schedule ?? '',
        suspend: String(c.spec?.suspend ?? false),
        'last schedule': ageOf(c.status?.lastScheduleTime)
      }
    }
  },
  services: (o) => {
    const s = o as V1Service
    return {
      ...base(s.metadata),
      columns: {
        type: s.spec?.type ?? '',
        'cluster-ip': s.spec?.clusterIP ?? '',
        ports: (s.spec?.ports ?? [])
          .map((p) => `${p.port}${p.protocol && p.protocol !== 'TCP' ? '/' + p.protocol : ''}`)
          .join(', ')
      }
    }
  },
  ingresses: (o) => {
    const i = o as V1Ingress
    return {
      ...base(i.metadata),
      columns: {
        class: i.spec?.ingressClassName ?? '',
        hosts: (i.spec?.rules ?? [])
          .map((r) => r.host)
          .filter(Boolean)
          .join(', ')
      }
    }
  },
  endpoints: (o) => {
    const e = o as V1Endpoints
    return {
      ...base(e.metadata),
      columns: {
        endpoints: String((e.subsets ?? []).reduce((a, s) => a + (s.addresses?.length ?? 0), 0))
      }
    }
  },
  configmaps: (o) => {
    const c = o as V1ConfigMap
    return {
      ...base(c.metadata),
      columns: { keys: String(Object.keys(c.data ?? {}).length) }
    }
  },
  secrets: (o) => {
    const s = o as V1Secret
    return {
      ...base(s.metadata),
      columns: { type: s.type ?? '', keys: String(Object.keys(s.data ?? {}).length) }
    }
  },
  pvc: (o) => {
    const p = o as V1PersistentVolumeClaim
    return {
      ...base(p.metadata),
      columns: {
        status: p.status?.phase ?? '',
        capacity: p.status?.capacity?.storage ?? '',
        'storage-class': p.spec?.storageClassName ?? '',
        volume: p.spec?.volumeName ?? ''
      }
    }
  },
  pv: (o) => {
    const p = o as V1PersistentVolume
    return {
      ...base(p.metadata),
      columns: {
        status: p.status?.phase ?? '',
        capacity: p.spec?.capacity?.storage ?? '',
        claim: p.spec?.claimRef ? `${p.spec.claimRef.namespace}/${p.spec.claimRef.name}` : '',
        'storage-class': p.spec?.storageClassName ?? ''
      }
    }
  },
  namespaces: (o) => {
    const n = o as V1Namespace
    return { ...base(n.metadata), columns: { status: n.status?.phase ?? '' } }
  },
  roles: (o) => {
    const r = o as V1Role
    return { ...base(r.metadata), columns: { rules: String(r.rules?.length ?? 0) } }
  },
  clusterroles: (o) => {
    const r = o as V1ClusterRole
    return { ...base(r.metadata), columns: { rules: String(r.rules?.length ?? 0) } }
  },
  rolebindings: (o) => {
    const b = o as V1RoleBinding
    return {
      ...base(b.metadata),
      columns: {
        role: `${b.roleRef?.kind ?? ''}/${b.roleRef?.name ?? ''}`,
        subjects: String(b.subjects?.length ?? 0)
      }
    }
  },
  clusterrolebindings: (o) => {
    const b = o as V1ClusterRoleBinding
    return {
      ...base(b.metadata),
      columns: {
        role: `${b.roleRef?.kind ?? ''}/${b.roleRef?.name ?? ''}`,
        subjects: String(b.subjects?.length ?? 0)
      }
    }
  },
  serviceaccounts: (o) => {
    const s = o as V1ServiceAccount
    return { ...base(s.metadata), columns: { secrets: String(s.secrets?.length ?? 0) } }
  },
  crd: (o) => {
    const c = o as V1CustomResourceDefinition
    const served = (c.spec?.versions ?? []).filter((v) => v.served).map((v) => v.name)
    const storage = (c.spec?.versions ?? []).find((v) => v.storage)?.name ?? served[0] ?? ''
    return {
      ...base(c.metadata),
      columns: {
        group: c.spec?.group ?? '',
        kind: c.spec?.names?.kind ?? '',
        scope: c.spec?.scope ?? '',
        versions: served.join(', '),
        // Stashed (not rendered) - used to browse this CRD's instances.
        plural: c.spec?.names?.plural ?? '',
        version: storage
      }
    }
  }
}

// Pods use the bespoke Pod shape consumed by PodsView (no metrics). The mapper is
// shared by listPods and the live watch.
export function mapPod(p: V1Pod): Pod {
  const cs = p.status?.containerStatuses ?? []
  const total = cs.length || (p.spec?.containers?.length ?? 0)
  const ready = cs.filter((c) => c.ready).length
  let status = p.status?.phase ?? 'Unknown'
  for (const c of cs) {
    const w = c.state?.waiting?.reason
    if (w && w !== 'ContainerCreating') {
      status = w
      break
    }
    const t = c.state?.terminated?.reason
    if (t && t !== 'Completed') {
      status = t
      break
    }
  }
  const byName = new Map(cs.map((s) => [s.name, s]))
  const containers = (p.spec?.containers ?? []).map((c) => {
    const st = byName.get(c.name)
    const state = st?.state?.running
      ? 'Running'
      : (st?.state?.waiting?.reason ?? st?.state?.terminated?.reason ?? 'Unknown')
    return { name: c.name, ready: st?.ready ?? false, state }
  })
  return {
    name: p.metadata?.name ?? '',
    ns: p.metadata?.namespace ?? '',
    status,
    ready: `${ready}/${total}`,
    restarts: cs.reduce((a, c) => a + (c.restartCount ?? 0), 0),
    cpu: '—',
    mem: '—',
    node: p.spec?.nodeName ?? '—',
    age: ageOf(p.metadata?.creationTimestamp),
    ip: p.status?.podIP ?? '—',
    containers
  }
}

/** Stable identity for a Pod row (namespace/name). */
export const podKey = (p: Pod): string => `${p.ns}/${p.name}`
