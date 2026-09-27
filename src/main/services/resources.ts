import type {
  CustomResourceList,
  CustomResourceParams,
  Pod,
  ResourceRow
} from '../../shared/ipc-types'
import { kcForCluster, loadK8s } from './k8s-client'
import { base, mapPod, RESOURCE_MAPPERS, type Meta } from './resource-mappers'
import { WATCH_SPECS } from './resource-watch-specs'

import { fetchTable, listViaTable } from './resource-table'

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
