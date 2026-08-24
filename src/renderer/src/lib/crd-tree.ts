import type { ResourceRow } from '../../../shared/ipc-types'

/** One CRD kind, ready to render as a sidebar leaf and to open its instances. */
export interface CrdLeaf {
  /** The CRD object's name (FQDN, e.g. `ackalertrules.alert.alibabacloud.com`) —
   *  unique within a cluster, used for the instances tab id. */
  name: string
  kind: string
  displayName: string
  group: string
  version: string
  plural: string
  namespaced: boolean
}

export interface CrdGroup {
  group: string
  crds: CrdLeaf[]
}

/** Turn a CRD's `spec.names.kind` into a friendly label:
 *  `AckAlertRule` → `Ack Alert Rule`, `HTTPRoute` → `HTTP Route`. */
export function humanizeKind(kind: string): string {
  return kind
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camel/Pascal boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // acronym → word boundary
    .trim()
}

/** Group CRD rows (from `listResource('crd')`) by API group, sorted alphabetically;
 *  kinds within each group sorted by display name. Pure — built from `row.columns`,
 *  whose fields are populated by the `crd` mapper in main/services/resources.ts. */
export function groupCrds(rows: ResourceRow[]): CrdGroup[] {
  const byGroup = new Map<string, CrdLeaf[]>()
  for (const r of rows) {
    const c = r.columns
    const kind = c.kind || r.name
    const leaf: CrdLeaf = {
      name: r.name,
      kind,
      displayName: humanizeKind(kind),
      group: c.group ?? '',
      version: c.version ?? '',
      plural: c.plural ?? '',
      namespaced: c.scope === 'Namespaced'
    }
    const arr = byGroup.get(leaf.group)
    if (arr) arr.push(leaf)
    else byGroup.set(leaf.group, [leaf])
  }
  return [...byGroup.entries()]
    .map(([group, crds]) => ({
      group,
      crds: crds.sort((a, b) => a.displayName.localeCompare(b.displayName))
    }))
    .sort((a, b) => a.group.localeCompare(b.group))
}
