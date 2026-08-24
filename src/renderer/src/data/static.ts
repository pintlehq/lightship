import type { HistoryItem, Tone } from '@renderer/ui/lib/types'
import type { LightshipTreeNode, Cluster, KubeEvent, ManageClusterRow } from '../types'

export const LIGHTSHIP_TREE: LightshipTreeNode[] = [
  { type: 'item', icon: 'activity', label: 'Overview', id: 'overview' },
  { type: 'item', icon: 'server', label: 'Nodes', id: 'nodes', count: 12 },
  {
    type: 'group',
    icon: 'box',
    label: 'Workloads',
    id: 'workloads',
    children: [
      { icon: 'box', label: 'Pods', id: 'pods', count: 42 },
      { icon: 'layers', label: 'Deployments', id: 'deployments', count: 18 },
      { icon: 'layers', label: 'StatefulSets', id: 'statefulsets', count: 4 },
      { icon: 'layers', label: 'DaemonSets', id: 'daemonsets', count: 6 },
      { icon: 'workflow', label: 'Jobs', id: 'jobs', count: 11 },
      { icon: 'history', label: 'CronJobs', id: 'cronjobs', count: 7 }
    ]
  },
  {
    type: 'group',
    icon: 'network',
    label: 'Network',
    id: 'network',
    children: [
      { icon: 'network', label: 'Services', id: 'services', count: 23 },
      { icon: 'link', label: 'Ingresses', id: 'ingresses', count: 8 },
      { icon: 'network', label: 'Endpoints', id: 'endpoints', count: 23 },
      { icon: 'arrowRight', label: 'Port forwards', id: 'port-forwards' }
    ]
  },
  {
    type: 'group',
    icon: 'file',
    label: 'Config',
    id: 'config',
    children: [
      { icon: 'file', label: 'ConfigMaps', id: 'configmaps', count: 31 },
      { icon: 'key', label: 'Secrets', id: 'secrets', count: 19 }
    ]
  },
  {
    type: 'group',
    icon: 'hardDrive',
    label: 'Storage',
    id: 'storage',
    children: [
      { icon: 'hardDrive', label: 'PersistentVolumes', id: 'pv', count: 14 },
      { icon: 'hardDrive', label: 'PVClaims', id: 'pvc', count: 22 }
    ]
  },
  { type: 'item', icon: 'bell', label: 'Events', id: 'events' },
  { type: 'item', icon: 'zap', label: 'Helm Releases', id: 'helm', count: 9 },
  {
    type: 'group',
    icon: 'shield',
    label: 'Access Control',
    id: 'rbac',
    children: [
      { icon: 'shield', label: 'Roles', id: 'roles' },
      { icon: 'shield', label: 'RoleBindings', id: 'rolebindings' },
      { icon: 'shield', label: 'ClusterRoles', id: 'clusterroles' },
      { icon: 'shield', label: 'ClusterRoleBindings', id: 'clusterrolebindings' },
      { icon: 'key', label: 'ServiceAccounts', id: 'serviceaccounts' }
    ]
  },
  // Anchor only — the sidebar special-cases id 'crd' and renders the dynamic,
  // API-group-grouped Custom Resources subtree (see custom-resources-tree.tsx).
  { type: 'group', icon: 'puzzle', label: 'Custom Resources', id: 'crd', children: [] }
]

export const LIGHTSHIP_CLUSTERS: Cluster[] = [
  { id: 'prod', name: 'prod-eu-west-1', env: 'prod', health: 'success', active: true },
  { id: 'staging', name: 'staging-eu-west-1', env: 'staging', health: 'warning' },
  { id: 'dev', name: 'dev-local', env: 'dev', health: 'success' }
]

export const POD_STATUS: Record<string, Tone> = {
  Running: 'success',
  Pending: 'warning',
  CrashLoopBackOff: 'destructive',
  Completed: 'info',
  Terminating: 'warning',
  Error: 'destructive'
}

export const NODE_STATUS: Record<string, Tone> = {
  Ready: 'success',
  NotReady: 'destructive',
  SchedulingDisabled: 'warning'
}

export const LIGHTSHIP_EVENTS: KubeEvent[] = [
  {
    tone: 'destructive',
    type: 'Warning',
    reason: 'BackOff',
    obj: 'payments-gateway-6d9f-x2klp',
    msg: 'Back-off restarting failed container gateway',
    age: '38m'
  },
  {
    tone: 'warning',
    type: 'Warning',
    reason: 'Unhealthy',
    obj: 'payments-gateway-6d9f-x2klp',
    msg: 'Readiness probe failed: HTTP 503',
    age: '38m'
  },
  {
    tone: 'info',
    type: 'Normal',
    reason: 'Scheduled',
    obj: 'istio-proxy-injector-5f-d8h',
    msg: 'Successfully assigned to ip-10-2-22-7',
    age: '2m'
  },
  {
    tone: 'info',
    type: 'Normal',
    reason: 'Pulled',
    obj: 'search-indexer-849c7-tn3vb',
    msg: 'Container image "search:2.4.1" already present',
    age: '2d'
  },
  {
    tone: 'info',
    type: 'Normal',
    reason: 'Created',
    obj: 'checkout-api-7f8c9b6d4-rh2sk',
    msg: 'Created container app',
    age: '4d'
  }
]

export const LIGHTSHIP_TERMINAL: Array<{ k: 'cmd' | 'dim' | 'out' | 'ok'; text: string }> = [
  { k: 'cmd', text: 'kubectl exec -it -n checkout checkout-api-7f8c9b6d4-rh2sk -c app -- /bin/sh' },
  { k: 'dim', text: '→ context: prod-eu-west-1   ·   ns: checkout' },
  { k: 'out', text: 'Defaulted container "app" out of: app, sidecar-istio' },
  { k: 'ok', text: '✓ connected · session id 9f8a2c' }
]

export interface YamlLine {
  t: 'key' | 'plain' | 'indent'
  k?: string
  v?: string
  text?: string
  d?: number
  num?: boolean
}

export const LIGHTSHIP_YAML: YamlLine[] = [
  { t: 'key', k: 'apiVersion', v: 'apps/v1' },
  { t: 'key', k: 'kind', v: 'Deployment' },
  { t: 'plain', text: 'metadata:' },
  { t: 'indent', k: 'name', v: 'checkout-api', d: 1 },
  { t: 'indent', k: 'namespace', v: 'checkout', d: 1 },
  { t: 'plain', text: 'spec:' },
  { t: 'indent', k: 'replicas', v: '2', d: 1, num: true },
  { t: 'indent', k: 'revisionHistoryLimit', v: '10', d: 1, num: true },
  { t: 'plain', text: '  selector:' },
  { t: 'indent', k: 'matchLabels', v: '', d: 2 },
  { t: 'indent', k: 'app', v: 'checkout-api', d: 3 }
]

export const MANAGE_CLUSTERS: ManageClusterRow[] = [
  {
    name: 'prod-eu-west-1',
    env: 'prod',
    health: 'success',
    ver: 'v1.29.4-eks',
    nodes: 12,
    ctx: 'eks-prod-euw1',
    sync: '8s ago'
  },
  {
    name: 'staging-eu-west-1',
    env: 'staging',
    health: 'warning',
    ver: 'v1.29.1-eks',
    nodes: 6,
    ctx: 'eks-staging-euw1',
    sync: '12s ago'
  },
  {
    name: 'dev-local',
    env: 'dev',
    health: 'success',
    ver: 'v1.30.0-k3s',
    nodes: 1,
    ctx: 'k3d-dev',
    sync: '3s ago'
  }
]

export const LIGHTSHIP_HISTORY: HistoryItem[] = [
  {
    icon: 'box',
    label: 'Opened pod checkout-api-rh2sk',
    sub: 'ns: checkout · prod-eu-west-1',
    time: '2m'
  },
  {
    icon: 'terminal',
    label: 'Exec into payments-gateway',
    sub: 'CrashLoopBackOff · debugging /bin/sh',
    time: '14m'
  },
  { icon: 'box', label: 'Viewed logs for search-indexer', sub: 'follow · 2.1k lines', time: '36m' },
  {
    icon: 'refresh',
    label: 'Restarted search-indexer',
    sub: 'rollout restart · 2 replicas',
    time: '1h'
  },
  { icon: 'file', label: 'Edited checkout-api.yaml', sub: 'replicas 2 → 3 · applied', time: '3h' },
  { icon: 'zap', label: 'Helm upgrade redis-cache', sub: 'chart 18.4.0 → 18.6.1', time: '5h' },
  {
    icon: 'shield',
    label: 'Reviewed RBAC for ci-deployer',
    sub: 'role binding · namespace checkout',
    time: '7h'
  },
  {
    icon: 'server',
    label: 'Cordoned node ip-10-2-22-7',
    sub: 'maintenance window · drained 6 pods',
    time: '1d'
  },
  { icon: 'box', label: 'Scaled deployment notifications', sub: '3 → 5 replicas', time: '2d' }
]
