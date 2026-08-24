// Content-tab id helpers.
//
// Tabs are deduped by id (tabs-store `openTab`), so the same nav item or resource
// in two different clusters must produce distinct ids — otherwise opening "Pods"
// in cluster B would just re-focus cluster A's "Pods" tab. Prefixing the cluster
// id keeps each cluster's tabs separate. Cluster-agnostic tabs (history, manage
// clusters, port-forwards) keep flat ids and don't use this.
export function clusterTabId(clusterId: string, id: string): string {
  return `${clusterId}:${id}`
}

// Sidebar nav ids that open a single shared, cluster-agnostic tab (their view
// carries no clusterId), so their tab id stays flat.
const CLUSTER_AGNOSTIC_NAV = new Set(['port-forwards'])

/** Tab id for a sidebar nav click — cluster-prefixed unless the nav item is
 *  cluster-agnostic. Used by both the open handler and the sidebar highlight so
 *  the two never disagree. */
export function navTabId(clusterId: string, id: string): string {
  return CLUSTER_AGNOSTIC_NAV.has(id) ? id : clusterTabId(clusterId, id)
}
