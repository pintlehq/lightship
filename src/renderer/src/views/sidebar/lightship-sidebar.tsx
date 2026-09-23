import { Fragment, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Sidebar, TreeRow } from '@renderer/ui/shell/sidebar'
import { Button } from '@renderer/ui/components/button'
import { ContextMenu } from '@renderer/ui/components/context-menu'
import { Dot } from '@renderer/ui/components/dot'
import { Icon } from '@renderer/ui/components/icon'
import { toast } from '@renderer/ui/components/toaster'

import type { ClusterMeta } from '../../../../shared/ipc-types'
import { LIGHTSHIP_TREE } from '../../data/static'
import type { CrdLeaf } from '../../lib/crd-tree'
import { clustersApi } from '../../lib/ipc'
import { navTabId } from '../../lib/tab-id'
import { ensureClusterConnection, useClusterConnections } from '../../queries/cluster-connection'
import { qk } from '../../queries/keys'
import { useClusters, useRemoveCluster } from '../../queries/use-lightship-data'
import { useUiStore } from '../../stores/ui-store'
import type { LightshipTreeNode } from '../../types'
import { ConfirmDialog } from '../confirm-dialog'
import { CustomResourcesTree } from './custom-resources-tree'

// Groups open by default when a cluster's tree is first expanded.
const DEFAULT_OPEN: Record<string, boolean> = { workloads: true }

export interface LightshipSidebarProps {
  /** Active content-tab id — drives row highlight. */
  active: string
  /** Cluster of the active tab — drives the cluster-header emphasis. */
  activeClusterId: string | null
  onSelect: (clusterId: string, id: string, label: string) => void
  onOpenCrdKind: (clusterId: string, leaf: CrdLeaf) => void
  onAddCluster: () => void
  onManageClusters: () => void
  onNewTerminal: (cluster: ClusterMeta) => void
}

export function LightshipSidebar({
  active,
  activeClusterId,
  onSelect,
  onOpenCrdKind,
  onAddCluster,
  onManageClusters,
  onNewTerminal
}: LightshipSidebarProps) {
  const { data: clusters = [] } = useClusters()
  const checks = useClusterConnections(clusters.map((cluster) => cluster.id))
  const qc = useQueryClient()
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [removing, setRemoving] = useState<ClusterMeta | null>(null)
  const remove = useRemoveCluster()
  // Group fold state, keyed per cluster (`${clusterId}::${groupId}`) so folding a
  // group under one cluster doesn't bleed into other expanded clusters. Default-open
  // is decided by presence, not truthiness, so an explicit close sticks.
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const gkey = (clusterId: string, gid: string) => `${clusterId}::${gid}`
  const isGroupOpen = (clusterId: string, gid: string): boolean => {
    const k = gkey(clusterId, gid)
    return k in open ? open[k] : (DEFAULT_OPEN[gid] ?? false)
  }
  const toggleGroup = (clusterId: string, gid: string) => {
    if (gid === 'crd' && !isGroupOpen(clusterId, gid)) {
      void ensureClusterConnection(qc, clusterId).then((result) => {
        if (result.ok) setOpen((current) => ({ ...current, [gkey(clusterId, gid)]: true }))
        else {
          const name = clusters.find((cluster) => cluster.id === clusterId)?.name ?? clusterId
          toast.error(`Could not connect to ${name}`, result.error ?? 'Connection failed')
        }
      })
      return
    }
    setOpen((o) => {
      const k = gkey(clusterId, gid)
      const cur = k in o ? o[k] : (DEFAULT_OPEN[gid] ?? false)
      return { ...o, [k]: !cur }
    })
  }

  // Which cluster trees are expanded — independent of any active tab, so multiple
  // can be open at once. Seeded to the first cluster on first load (below).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggleCluster = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const openCluster = (cl: ClusterMeta): void => {
    setExpanded((current) => new Set(current).add(cl.id))
    void ensureClusterConnection(qc, cl.id).then((result) => {
      if (!result.ok)
        toast.error(`Could not connect to ${cl.name}`, result.error ?? 'Connection failed')
    })
  }

  const startRename = (cl: ClusterMeta): void => {
    setRenamingId(cl.id)
    setDraft(cl.name)
  }
  const commitRename = async (cl: ClusterMeta): Promise<void> => {
    const name = draft.trim()
    setRenamingId(null)
    if (name && name !== cl.name) {
      await clustersApi.rename(cl.id, name)
      await qc.invalidateQueries({ queryKey: qk.clusters() })
    }
  }

  // Refresh all cached data for one cluster — every per-cluster query key carries
  // the cluster id at index 1 (resources, custom resources, overview, nodes, …).
  const refreshCluster = (cl: ClusterMeta): void => {
    void qc
      .invalidateQueries({ predicate: (q) => q.queryKey[1] === cl.id })
      .then(() => toast.success(`Refreshed ${cl.name}`))
  }

  // Expand the first cluster's tree once, when clusters first load, so the sidebar
  // isn't a wall of collapsed nodes. The user can expand/collapse any others freely.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || clusters.length === 0) return
    seeded.current = true
    setExpanded(new Set([clusters[0].id]))
  }, [clusters])

  const renderNode = (n: LightshipTreeNode, depth: number, clusterId: string) => {
    // The Custom Resources section is dynamic (CRDs grouped by API group), so it
    // renders its own subtree rather than the generic static group.
    if (n.id === 'crd') {
      return (
        <CustomResourcesTree
          key={n.id}
          clusterId={clusterId}
          depth={depth}
          active={active}
          isGroupOpen={isGroupOpen}
          toggleGroup={toggleGroup}
          onSelect={onSelect}
          onOpenCrdKind={onOpenCrdKind}
        />
      )
    }
    if (n.type === 'group') {
      return (
        <Fragment key={n.id}>
          <TreeRow
            depth={depth}
            caret={isGroupOpen(clusterId, n.id)}
            onToggle={() => toggleGroup(clusterId, n.id)}
            icon={n.icon}
            label={n.label}
            onClick={() => toggleGroup(clusterId, n.id)}
          />
          {isGroupOpen(clusterId, n.id) &&
            n.children?.map((c) => (
              <TreeRow
                key={c.id}
                depth={depth + 1}
                icon={c.icon}
                label={c.label}
                active={active === navTabId(clusterId, c.id)}
                onClick={() => onSelect(clusterId, c.id, c.label)}
              />
            ))}
        </Fragment>
      )
    }
    return (
      <TreeRow
        key={n.id}
        depth={depth}
        icon={n.icon}
        label={n.label}
        active={active === navTabId(clusterId, n.id)}
        onClick={() => onSelect(clusterId, n.id, n.label)}
      />
    )
  }

  return (
    <>
      <Sidebar
        title="Clusters"
        searchPlaceholder="filter tree…"
        width={sidebarWidth}
        onResize={setSidebarWidth}
        actions={[
          { icon: 'plus', label: 'Add cluster', onClick: onAddCluster },
          { icon: 'layers', label: 'Manage clusters', onClick: onManageClusters }
        ]}
      >
        {clusters.length === 0 ? (
          <div className="space-y-3 px-4 py-8 text-center font-mono">
            <Icon name="server" className="mx-auto h-7 w-7 text-faint" />
            <p className="text-[12px] text-dim">No clusters yet</p>
            <Button size="sm" onClick={onAddCluster}>
              <Icon name="plus" className="h-3 w-3" />
              Add cluster
            </Button>
          </div>
        ) : (
          clusters.map((cl, index) => {
            const isActive = cl.id === activeClusterId
            const isExpanded = expanded.has(cl.id)
            const renaming = renamingId === cl.id
            const check = checks[index]
            const checking = check?.isFetching ?? false
            const result = check?.data
            const status = checking
              ? 'connecting'
              : result?.ok
                ? 'connected'
                : result || check?.isError
                  ? 'error'
                  : 'not checked'
            const error = checking
              ? ''
              : (result?.error ?? (check?.error instanceof Error ? check.error.message : ''))
            return (
              <Fragment key={cl.id}>
                <ContextMenu
                  items={[
                    { label: 'Refresh', onSelect: () => refreshCluster(cl) },
                    { label: 'Rename', onSelect: () => startRename(cl) },
                    { label: 'New terminal', onSelect: () => onNewTerminal(cl) },
                    {
                      label: 'Remove',
                      danger: true,
                      separatorBefore: true,
                      onSelect: () => setRemoving(cl)
                    }
                  ]}
                >
                  <div>
                    <TreeRow
                      depth={0}
                      caret={isExpanded}
                      onToggle={renaming ? undefined : () => toggleCluster(cl.id)}
                      icon="server"
                      iconClass="text-primary opacity-100"
                      label={
                        renaming ? (
                          <input
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void commitRename(cl)
                              else if (e.key === 'Escape') setRenamingId(null)
                            }}
                            onBlur={() => void commitRename(cl)}
                            className="h-[18px] w-full min-w-0 rounded border border-primary bg-background px-1 font-mono text-[12.5px] text-foreground outline-none"
                          />
                        ) : (
                          cl.name
                        )
                      }
                      active={isActive}
                      className="font-medium text-foreground"
                      onClick={renaming ? undefined : () => openCluster(cl)}
                      trailing={
                        <span
                          className="ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] text-dim"
                          title={error || status}
                          aria-label={`${cl.name}: ${status}${error ? `: ${error}` : ''}`}
                        >
                          <Dot
                            tone={
                              checking
                                ? 'primary'
                                : result?.ok
                                  ? 'success'
                                  : status === 'error'
                                    ? 'destructive'
                                    : 'dim'
                            }
                            pulse={checking}
                          />
                          {status !== 'not checked' && status}
                          {cl.env === 'prod' && (
                            <Icon name="lock" className="h-3 w-3 text-destructive" />
                          )}
                        </span>
                      }
                    />
                  </div>
                </ContextMenu>
                {status === 'error' && (
                  <div
                    role="alert"
                    className="mx-3 mb-1 ml-8 flex items-start gap-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 font-mono text-[10.5px] text-destructive"
                  >
                    <span className="min-w-0 flex-1 break-words">
                      {error || 'Connection failed'}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 underline underline-offset-2 hover:text-foreground"
                      onClick={() => openCluster(cl)}
                    >
                      Retry
                    </button>
                  </div>
                )}
                {isExpanded && LIGHTSHIP_TREE.map((n) => renderNode(n, 1, cl.id))}
              </Fragment>
            )
          })
        )}
      </Sidebar>
      <ConfirmDialog
        open={!!removing}
        danger
        title={removing ? `Remove "${removing.name}"?` : ''}
        message="Removes the cluster from Lightship and deletes its stored kubeconfig. The cluster itself is not affected, and any open tabs for it will close."
        confirmLabel="Remove"
        busy={remove.isPending}
        onConfirm={() =>
          removing && remove.mutate(removing.id, { onSuccess: () => setRemoving(null) })
        }
        onCancel={() => setRemoving(null)}
      />
    </>
  )
}
