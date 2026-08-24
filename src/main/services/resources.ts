import * as https from 'node:https'

import type { KubeConfig, KubernetesObject } from '@kubernetes/client-node'

import type {
  ConfigData,
  ContainerInfo,
  CustomResourceList,
  CustomResourceParams,
  Pod,
  PortInfo,
  ResourceDetail,
  ResourceRef,
  ResourceRow
} from '../../shared/ipc-types'
import { kcForCluster, loadK8s } from './k8s'
import { GVK, resolveGvk } from './resource-gvk'
import { base, type Meta, mapPod, RESOURCE_MAPPERS } from './resource-mappers'
import { objectApi } from './resource-mutations'
import { WATCH_SPECS } from './resource-watch-specs'

export { GVK, resolveGvk } from './resource-gvk'
export { base, mapPod, podKey, RESOURCE_MAPPERS } from './resource-mappers'
export {
  applyYaml,
  cordonNode,
  createYaml,
  deleteResource,
  drainNode,
  getYaml,
  isEvictable,
  rolloutRestart,
  scaleResource,
  uncordonNode
} from './resource-mutations'
export { isListableResource, WATCH_SPECS } from './resource-watch-specs'

/** A row from the Kubernetes Table API: PartialObjectMetadata + server print-column cells
 *  (keyed by lowercased column name). Fetched without the object's heavy `.data`. */
type TableListRow = { metadata: Meta; cells: Record<string, string> }

/** List a collection via the Kubernetes **Table** API (`as=Table`) - server-rendered print
 *  columns + metadata only, so large `.data`/`.binaryData` payloads are never transferred.
 *  Uses `applyToHTTPSOptions` (auth + cluster CA/client-cert) over node `https`, the same
 *  TLS the typed client uses. */
type RawTable = {
  columnDefinitions: Array<{ name: string; priority?: number }>
  rows: Array<{ cells: unknown[]; metadata: Meta }>
}

/** Raw `as=Table` fetch for a collection path - column definitions (with their
 *  print priority) + per-row cells and object metadata. */
export async function fetchTable(kc: KubeConfig, path: string): Promise<RawTable> {
  const cluster = kc.getCurrentCluster()
  if (!cluster) throw new Error('No current cluster')
  const url = new URL(`${cluster.server}${path}`)
  const opts: https.RequestOptions = {
    method: 'GET',
    host: url.hostname,
    port: url.port || 443,
    path: url.pathname + url.search
  }
  await kc.applyToHTTPSOptions(opts)
  opts.headers = { ...opts.headers, Accept: 'application/json;as=Table;v=v1;g=meta.k8s.io' }
  const body = await new Promise<string>((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (data += c))
      res.on('end', () =>
        res.statusCode && res.statusCode >= 200 && res.statusCode < 300
          ? resolve(data)
          : reject(new Error(`Table list ${path} failed: ${res.statusCode}`))
      )
    })
    req.on('error', reject)
    req.end()
  })
  const table = JSON.parse(body) as {
    columnDefinitions?: Array<{ name: string; priority?: number }>
    rows?: Array<{ cells: unknown[]; object?: { metadata?: Meta } }>
  }
  return {
    columnDefinitions: table.columnDefinitions ?? [],
    rows: (table.rows ?? []).map((r) => ({ cells: r.cells, metadata: r.object?.metadata ?? {} }))
  }
}

export async function listViaTable(kc: KubeConfig, path: string): Promise<TableListRow[]> {
  const t = await fetchTable(kc, path)
  const names = t.columnDefinitions.map((d) => d.name.toLowerCase())
  return t.rows.map((row) => {
    const cells: Record<string, string> = {}
    names.forEach((n, i) => {
      cells[n] = row.cells[i] == null ? '' : String(row.cells[i])
    })
    return { metadata: row.metadata, cells }
  })
}

export async function listResource(
  clusterId: string,
  kind: string,
  _namespace?: string
): Promise<ResourceRow[]> {
  const spec = WATCH_SPECS[kind]
  const map = RESOURCE_MAPPERS[kind]
  if (!spec || !map) return []
  const kc = await kcForCluster(clusterId)
  if (spec.table) {
    try {
      const rows = await listViaTable(kc, spec.path)
      return rows.map((r) => ({ ...base(r.metadata), columns: spec.table!.columns(r.cells) }))
    } catch (e) {
      // Table API unsupported/unavailable - fall back to the full typed list.
      console.warn(`[resources] Table list failed for ${kind}, falling back to full list:`, e)
    }
  }
  const list = await spec.list(kc)()
  return list.items.map(map)
}

/** Live instances of a CRD (dynamic GVK), as generic ResourceRows. */
// Print columns rendered specially by the instances list/detail (so they're
// dropped from the CRD's dynamic additional printer columns).
const CR_SKIP_COLUMNS = new Set(['name', 'namespace', 'age', 'created at'])

export async function listCustomResource(
  clusterId: string,
  params: CustomResourceParams
): Promise<CustomResourceList> {
  const kc = await kcForCluster(clusterId)
  const { group, version, plural, namespaced } = params
  const path = `/apis/${group}/${version}/${plural}`
  try {
    // Server-rendered Table -> the CRD's additionalPrinterColumns + metadata.
    const t = await fetchTable(kc, path)
    const cols = t.columnDefinitions
      .map((d, i) => ({ i, name: d.name, priority: d.priority ?? 0 }))
      .filter((d) => d.priority === 0 && !CR_SKIP_COLUMNS.has(d.name.toLowerCase()))
    const columns = cols.map((d) => ({ key: d.name.toLowerCase(), header: d.name }))
    const rows: ResourceRow[] = t.rows.map((row) => {
      const columnsMap: Record<string, string> = {}
      for (const d of cols)
        columnsMap[d.name.toLowerCase()] = row.cells[d.i] == null ? '' : String(row.cells[d.i])
      return { ...base(row.metadata), columns: columnsMap }
    })
    return { columns, rows }
  } catch (e) {
    // Table API unsupported/unavailable - fall back to the typed dynamic list.
    console.warn(`[resources] Table list failed for ${path}, falling back:`, e)
    const { CustomObjectsApi } = await loadK8s()
    const api = kc.makeApiClient(CustomObjectsApi)
    const res = namespaced
      ? await api.listCustomObjectForAllNamespaces({ group, version, resourcePlural: plural })
      : await api.listClusterCustomObject({ group, version, plural })
    const items = (res as { items?: { metadata?: Meta }[] }).items ?? []
    return { columns: [], rows: items.map((it) => ({ ...base(it.metadata), columns: {} })) }
  }
}

export async function listPods(clusterId: string): Promise<Pod[]> {
  const { CoreV1Api } = await loadK8s()
  const kc = await kcForCluster(clusterId)
  const res = await kc.makeApiClient(CoreV1Api).listPodForAllNamespaces()
  return res.items.map(mapPod)
}

// --- live object detail (Overview tab) -----------------------------------

/** CPU quantity -> millicores ("500m" -> 500, "1" -> 1000). */
export function parseCpu(q: string): number {
  if (q.endsWith('m')) return parseInt(q, 10) || 0
  const n = parseFloat(q)
  return Number.isFinite(n) ? Math.round(n * 1000) : 0
}

const MEM_UNITS: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15
}
/** Memory quantity -> bytes ("1Gi" -> 2^30, "512Mi" -> ...), rounded. */
export function parseMem(q: string): number {
  const m = /^(\d+(?:\.\d+)?)([A-Za-z]+)?$/.exec(q.trim())
  if (!m) return 0
  return Math.round(parseFloat(m[1]) * (m[2] ? (MEM_UNITS[m[2]] ?? 1) : 1))
}
const formatCpu = (milli: number): string => (milli % 1000 === 0 ? `${milli / 1000}` : `${milli}m`)
const formatMem = (bytes: number): string => {
  const gi = 1024 ** 3
  if (bytes >= gi) {
    const v = bytes / gi
    return `${Number.isInteger(v) ? v : v.toFixed(1)}Gi`
  }
  return `${Math.round(bytes / 1024 ** 2)}Mi`
}

/** Dedup ports by number, dropping zero/unset. */
function dedupePorts(ports: PortInfo[]): PortInfo[] {
  const seen = new Set<number>()
  const out: PortInfo[] = []
  for (const p of ports) {
    if (p.port > 0 && !seen.has(p.port)) {
      seen.add(p.port)
      out.push(p)
    }
  }
  return out
}

// Minimal view over the bits of a workload/service we read for ports.
type WithPorts = {
  spec?: {
    ports?: { name?: string; port?: number; protocol?: string }[]
    template?: {
      spec?: {
        containers?: { ports?: { name?: string; containerPort?: number; protocol?: string }[] }[]
      }
    }
  }
}

/** Live object fields for a resource's Overview tab. Pods carry containers/QoS/limits. */
export async function getResourceDetail(
  clusterId: string,
  ref: ResourceRef
): Promise<ResourceDetail> {
  if (ref.kind === 'pods') {
    const { CoreV1Api } = await loadK8s()
    const kc = await kcForCluster(clusterId)
    const p = await kc
      .makeApiClient(CoreV1Api)
      .readNamespacedPod({ name: ref.name, namespace: ref.namespace ?? 'default' })

    const statuses = p.status?.containerStatuses ?? []
    const containers: ContainerInfo[] = (p.spec?.containers ?? []).map((c) => {
      const st = statuses.find((s) => s.name === c.name)
      const state = st?.state?.running
        ? 'Running'
        : (st?.state?.waiting?.reason ?? st?.state?.terminated?.reason ?? 'Unknown')
      return {
        name: c.name,
        image: c.image ?? '',
        ready: st?.ready ?? false,
        state,
        restarts: st?.restartCount ?? 0
      }
    })

    let cpuM = 0
    let memB = 0
    let hasCpu = false
    let hasMem = false
    for (const c of p.spec?.containers ?? []) {
      const lim = c.resources?.limits
      if (lim?.cpu) {
        cpuM += parseCpu(lim.cpu)
        hasCpu = true
      }
      if (lim?.memory) {
        memB += parseMem(lim.memory)
        hasMem = true
      }
    }

    const ports = dedupePorts(
      (p.spec?.containers ?? [])
        .flatMap((c) => c.ports ?? [])
        .map((cp) => ({ name: cp.name, port: cp.containerPort, protocol: cp.protocol }))
    )

    return {
      labels: p.metadata?.labels ?? {},
      qosClass: p.status?.qosClass,
      cpuLimit: hasCpu ? formatCpu(cpuM) : undefined,
      memLimit: hasMem ? formatMem(memB) : undefined,
      containers,
      ports: ports.length ? ports : undefined
    }
  }

  const gvk = resolveGvk(ref)
  if (!gvk) throw new Error(`Unknown resource kind: ${ref.kind}`)
  const obj = await objectApi(clusterId)
  const live = (await obj.read({
    apiVersion: gvk.apiVersion,
    kind: gvk.kind,
    metadata: { name: ref.name, namespace: gvk.namespaced ? ref.namespace : undefined }
  })) as KubernetesObject &
    WithPorts & {
      metadata?: {
        creationTimestamp?: string | Date
        finalizers?: string[]
        labels?: Record<string, string>
      }
      status?: { conditions?: Array<{ type?: string; status?: string; reason?: string }> }
    }

  const ports =
    ref.kind === 'services'
      ? dedupePorts(
          (live.spec?.ports ?? []).map((p) => ({
            name: p.name,
            port: p.port ?? 0,
            protocol: p.protocol
          }))
        )
      : dedupePorts(
          (live.spec?.template?.spec?.containers ?? [])
            .flatMap((c) => c.ports ?? [])
            .map((cp) => ({ name: cp.name, port: cp.containerPort ?? 0, protocol: cp.protocol }))
        )

  const ts = live.metadata?.creationTimestamp
  const finalizers = live.metadata?.finalizers ?? []
  const conditions = (live.status?.conditions ?? [])
    .map((c) => ({ type: c.type ?? '', status: c.status ?? '', reason: c.reason }))
    .filter((c) => c.type)

  return {
    labels: live.metadata?.labels ?? {},
    ports: ports.length ? ports : undefined,
    created: ts ? String(ts) : undefined,
    finalizers: finalizers.length ? finalizers : undefined,
    conditions: conditions.length ? conditions : undefined
  }
}

// --- ConfigMap / Secret data (visual key/value editor) -------------------

type ConfigObject = KubernetesObject & {
  data?: Record<string, string>
  binaryData?: Record<string, string>
  stringData?: Record<string, string>
}

/** A base64 value is "text" if it round-trips as utf-8 with no control chars. */
function decodeTextSecret(b64: string): string | null {
  const buf = Buffer.from(b64, 'base64')
  const text = buf.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(buf)) return null
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    // Reject non-printable control chars (tab/newline/carriage-return are fine).
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) return null
  }
  return text
}

async function readConfigObject(clusterId: string, ref: ResourceRef): Promise<ConfigObject> {
  const gvk = GVK[ref.kind]
  if (!gvk) throw new Error(`Unknown resource kind: ${ref.kind}`)
  const obj = await objectApi(clusterId)
  return (await obj.read({
    apiVersion: gvk.apiVersion,
    kind: gvk.kind,
    metadata: { name: ref.name, namespace: ref.namespace }
  })) as ConfigObject
}

export async function getConfigData(clusterId: string, ref: ResourceRef): Promise<ConfigData> {
  const live = await readConfigObject(clusterId, ref)
  if (ref.kind === 'secrets') {
    const data: Record<string, string> = {}
    const binaryKeys: string[] = []
    for (const [k, v] of Object.entries(live.data ?? {})) {
      const text = decodeTextSecret(v)
      if (text == null) binaryKeys.push(k)
      else data[k] = text
    }
    return { secret: true, data, binaryKeys }
  }
  return { secret: false, data: live.data ?? {}, binaryKeys: Object.keys(live.binaryData ?? {}) }
}

export async function applyConfigData(
  clusterId: string,
  ref: ResourceRef,
  data: Record<string, string>
): Promise<void> {
  const live = await readConfigObject(clusterId, ref)
  if (ref.kind === 'secrets') {
    // Preserve binary entries (kept as their existing base64); re-encode text entries.
    const next: Record<string, string> = {}
    for (const [k, v] of Object.entries(live.data ?? {})) {
      if (decodeTextSecret(v) == null) next[k] = v
    }
    for (const [k, v] of Object.entries(data)) next[k] = Buffer.from(v, 'utf8').toString('base64')
    live.data = next
    delete live.stringData
  } else {
    live.data = data // binaryData left untouched
  }
  const obj = await objectApi(clusterId)
  await obj.replace(live)
}
