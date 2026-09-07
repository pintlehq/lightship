import type {
  KubernetesObject,
  V1LimitRange,
  V1Namespace,
  V1NetworkPolicy,
  V1Pod,
  V1ResourceQuota
} from '@kubernetes/client-node'

import {
  isValidLabelKey,
  isValidLabelValue,
  isValidNamespaceName,
  NamespaceCreateInputSchema,
  type NamespaceAccess,
  type NamespaceCreateInput,
  type NamespaceDetail,
  type NamespaceLimitRange,
  type NamespaceNetworkPolicy,
  type NamespaceOptionalAccess,
  type NamespacePodStates,
  type NamespaceQuota,
  type NamespaceSummary,
  type NamespaceSummaryList
} from '../../shared/ipc-types'
import { ageOf, kcForCluster, loadK8s } from './k8s'

export const isNamespaceProtected = (name: string): boolean =>
  name === 'default' || name.startsWith('kube-')

const available = (): NamespaceAccess => ({ available: true })
const unavailable = (error: unknown): NamespaceAccess => ({
  available: false,
  message: error instanceof Error ? error.message : String(error)
})

async function optional<T>(
  work: () => Promise<T>
): Promise<{ data: T | null; access: NamespaceAccess }> {
  try {
    return { data: await work(), access: available() }
  } catch (error) {
    return { data: null, access: unavailable(error) }
  }
}

const readyPod = (pod: V1Pod): boolean =>
  (pod.status?.conditions ?? []).some(
    (condition) => condition.type === 'Ready' && condition.status === 'True'
  )

export function podStates(pods: V1Pod[]): NamespacePodStates {
  const out: NamespacePodStates = {
    total: pods.length,
    ready: pods.filter(readyPod).length,
    running: 0,
    pending: 0,
    succeeded: 0,
    failed: 0,
    unknown: 0
  }
  for (const pod of pods) {
    const phase = pod.status?.phase?.toLowerCase()
    if (phase === 'running') out.running += 1
    else if (phase === 'pending') out.pending += 1
    else if (phase === 'succeeded') out.succeeded += 1
    else if (phase === 'failed') out.failed += 1
    else out.unknown += 1
  }
  return out
}

function policyTypes(policy: V1NetworkPolicy): string[] {
  const explicit = policy.spec?.policyTypes ?? []
  if (explicit.length) return explicit
  return policy.spec?.egress ? ['Ingress', 'Egress'] : ['Ingress']
}

const allPodsSelector = (policy: V1NetworkPolicy): boolean => {
  const selector = policy.spec?.podSelector
  return (
    !selector ||
    (!Object.keys(selector.matchLabels ?? {}).length && !(selector.matchExpressions ?? []).length)
  )
}

function defaultDeny(policy: V1NetworkPolicy, direction: 'Ingress' | 'Egress'): boolean {
  const rules = direction === 'Ingress' ? policy.spec?.ingress : policy.spec?.egress
  return (
    allPodsSelector(policy) && policyTypes(policy).includes(direction) && (rules?.length ?? 0) === 0
  )
}

function selectorText(policy: V1NetworkPolicy): string {
  const selector = policy.spec?.podSelector
  const parts = Object.entries(selector?.matchLabels ?? {}).map(([key, value]) => `${key}=${value}`)
  for (const expression of selector?.matchExpressions ?? []) {
    const values = expression.values?.join(',') ?? ''
    parts.push(`${expression.key} ${expression.operator}${values ? ` (${values})` : ''}`)
  }
  return parts.length ? parts.join(', ') : '<all pods>'
}

export function mapNetworkPolicy(policy: V1NetworkPolicy): NamespaceNetworkPolicy {
  return {
    name: policy.metadata?.name ?? '',
    selector: selectorText(policy),
    policyTypes: policyTypes(policy),
    ingressRules: policy.spec?.ingress?.length ?? 0,
    egressRules: policy.spec?.egress?.length ?? 0,
    defaultDenyIngress: defaultDeny(policy, 'Ingress'),
    defaultDenyEgress: defaultDeny(policy, 'Egress')
  }
}

function resourceRecord(value?: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value ?? {}).map(([key, quantity]) => [key, String(quantity)])
  )
}

function quantityScalar(value: string): number {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([numkKMGTEP]i?)?$/.exec(value)
  if (!match) throw new Error(`Invalid Kubernetes quantity: ${value}`)
  const factors: Record<string, number> = {
    n: 1e-9,
    u: 1e-6,
    m: 1e-3,
    k: 1e3,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    P: 1e15,
    E: 1e18,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6
  }
  return Number(match[1]) * (factors[match[2] ?? ''] ?? 1)
}

function quantityPercent(used: string, hard: string): number | null {
  try {
    const denominator = quantityScalar(hard)
    const numerator = quantityScalar(used)
    return denominator > 0 && Number.isFinite(numerator)
      ? Math.round((numerator / denominator) * 1000) / 10
      : null
  } catch {
    return null
  }
}

function mapQuota(quota: V1ResourceQuota): NamespaceQuota {
  const hard = resourceRecord(quota.spec?.hard)
  const used = resourceRecord(quota.status?.used)
  return {
    name: quota.metadata?.name ?? '',
    scopes: quota.spec?.scopes ?? [],
    resources: Object.entries(hard).map(([resource, hardValue]) => ({
      resource,
      hard: hardValue,
      used: used[resource] ?? '0',
      percent: quantityPercent(used[resource] ?? '0', hardValue)
    }))
  }
}

function mapLimitRange(range: V1LimitRange): NamespaceLimitRange {
  return {
    name: range.metadata?.name ?? '',
    limits: (range.spec?.limits ?? []).map((limit) => ({
      type: limit.type,
      min: resourceRecord(limit.min),
      max: resourceRecord(limit.max),
      default: resourceRecord(limit._default),
      defaultRequest: resourceRecord(limit.defaultRequest),
      maxLimitRequestRatio: resourceRecord(limit.maxLimitRequestRatio)
    }))
  }
}

function namespaceStatus(namespace: V1Namespace): NamespaceSummary['status'] {
  if (namespace.metadata?.deletionTimestamp || namespace.status?.phase === 'Terminating')
    return 'Terminating'
  return namespace.status?.phase === 'Active' ? 'Active' : 'Unknown'
}

function groupByNamespace<T extends { metadata?: { namespace?: string } }>(
  items: T[]
): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const item of items) {
    const namespace = item.metadata?.namespace ?? ''
    grouped.set(namespace, [...(grouped.get(namespace) ?? []), item])
  }
  return grouped
}

function summaryFor(
  namespace: V1Namespace,
  pods: V1Pod[] | null,
  quotas: V1ResourceQuota[] | null,
  limits: V1LimitRange[] | null,
  policies: V1NetworkPolicy[] | null
): NamespaceSummary {
  const name = namespace.metadata?.name ?? ''
  const states = pods ? podStates(pods) : null
  return {
    name,
    uid: namespace.metadata?.uid ?? name,
    status: namespaceStatus(namespace),
    created:
      namespace.metadata?.creationTimestamp?.toISOString?.() ??
      String(namespace.metadata?.creationTimestamp ?? ''),
    age: ageOf(namespace.metadata?.creationTimestamp),
    protected: isNamespaceProtected(name),
    podsReady: states?.ready ?? null,
    podsTotal: states?.total ?? null,
    quotaCount: quotas?.length ?? null,
    limitRangeCount: limits?.length ?? null,
    networkPolicyCount: policies?.length ?? null,
    defaultDenyIngress: policies ? policies.some((policy) => defaultDeny(policy, 'Ingress')) : null,
    defaultDenyEgress: policies ? policies.some((policy) => defaultDeny(policy, 'Egress')) : null
  }
}

export async function listNamespaceSummaries(clusterId: string): Promise<NamespaceSummaryList> {
  const kc = await kcForCluster(clusterId)
  const { CoreV1Api, NetworkingV1Api } = await loadK8s()
  const core = kc.makeApiClient(CoreV1Api)
  const networking = kc.makeApiClient(NetworkingV1Api)
  const namespaces = (await core.listNamespace()).items
  const [pods, quotas, limits, policies] = await Promise.all([
    optional(async () => (await core.listPodForAllNamespaces()).items),
    optional(async () => (await core.listResourceQuotaForAllNamespaces()).items),
    optional(async () => (await core.listLimitRangeForAllNamespaces()).items),
    optional(async () => (await networking.listNetworkPolicyForAllNamespaces()).items)
  ])
  const podMap = pods.data ? groupByNamespace(pods.data) : null
  const quotaMap = quotas.data ? groupByNamespace(quotas.data) : null
  const limitMap = limits.data ? groupByNamespace(limits.data) : null
  const policyMap = policies.data ? groupByNamespace(policies.data) : null
  const access: NamespaceOptionalAccess = {
    pods: pods.access,
    quotas: quotas.access,
    limits: limits.access,
    policies: policies.access
  }
  return {
    items: namespaces.map((namespace) => {
      const name = namespace.metadata?.name ?? ''
      return summaryFor(
        namespace,
        podMap ? (podMap.get(name) ?? []) : null,
        quotaMap ? (quotaMap.get(name) ?? []) : null,
        limitMap ? (limitMap.get(name) ?? []) : null,
        policyMap ? (policyMap.get(name) ?? []) : null
      )
    }),
    access
  }
}

export async function getNamespaceDetail(
  clusterId: string,
  name: string
): Promise<NamespaceDetail> {
  const kc = await kcForCluster(clusterId)
  const { CoreV1Api, NetworkingV1Api } = await loadK8s()
  const core = kc.makeApiClient(CoreV1Api)
  const networking = kc.makeApiClient(NetworkingV1Api)
  const namespace = await core.readNamespace({ name })
  const [pods, quotas, limits, policies] = await Promise.all([
    optional(async () => (await core.listNamespacedPod({ namespace: name })).items),
    optional(async () => (await core.listNamespacedResourceQuota({ namespace: name })).items),
    optional(async () => (await core.listNamespacedLimitRange({ namespace: name })).items),
    optional(async () => (await networking.listNamespacedNetworkPolicy({ namespace: name })).items)
  ])
  const access: NamespaceOptionalAccess = {
    pods: pods.access,
    quotas: quotas.access,
    limits: limits.access,
    policies: policies.access
  }
  return {
    summary: summaryFor(namespace, pods.data, quotas.data, limits.data, policies.data),
    labels: namespace.metadata?.labels ?? {},
    annotations: namespace.metadata?.annotations ?? {},
    finalizers: namespace.spec?.finalizers ?? [],
    podStates: pods.data ? podStates(pods.data) : null,
    quotas: quotas.data ? quotas.data.map(mapQuota) : null,
    limitRanges: limits.data ? limits.data.map(mapLimitRange) : null,
    networkPolicies: policies.data ? policies.data.map(mapNetworkPolicy) : null,
    access
  }
}

function validateManifest(value: unknown): V1Namespace {
  const manifest = value as KubernetesObject
  if (!manifest || manifest.apiVersion !== 'v1' || manifest.kind !== 'Namespace') {
    throw new Error('YAML must contain a v1/Namespace object')
  }
  const name = manifest.metadata?.name ?? ''
  if (!isValidNamespaceName(name)) throw new Error('Namespace metadata.name is invalid')
  for (const [key, value] of Object.entries(manifest.metadata?.labels ?? {})) {
    if (!isValidLabelKey(key) || !isValidLabelValue(value)) throw new Error(`Invalid label: ${key}`)
  }
  return manifest as V1Namespace
}

export async function createNamespace(
  clusterId: string,
  rawInput: NamespaceCreateInput
): Promise<void> {
  const input = NamespaceCreateInputSchema.parse(rawInput)
  const kc = await kcForCluster(clusterId)
  const { CoreV1Api, loadYaml } = await loadK8s()
  const body =
    input.mode === 'form'
      ? ({
          apiVersion: 'v1',
          kind: 'Namespace',
          metadata: { name: input.name, labels: input.labels }
        } as V1Namespace)
      : validateManifest(loadYaml(input.yaml))
  await kc.makeApiClient(CoreV1Api).createNamespace({ body })
}

export async function deleteNamespace(clusterId: string, name: string): Promise<void> {
  if (!isValidNamespaceName(name)) throw new Error('Invalid namespace name')
  if (isNamespaceProtected(name))
    throw new Error(`Namespace ${name} is protected and cannot be deleted`)
  const kc = await kcForCluster(clusterId)
  const { CoreV1Api } = await loadK8s()
  await kc.makeApiClient(CoreV1Api).deleteNamespace({ name })
}
