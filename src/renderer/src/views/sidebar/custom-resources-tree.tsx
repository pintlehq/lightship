import { Fragment, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TreeRow } from '@renderer/ui/shell/sidebar'

import { fetchResource } from '../../data/fetchers'
import { groupCrds, type CrdLeaf } from '../../lib/crd-tree'
import { navTabId } from '../../lib/tab-id'
import { qk } from '../../queries/keys'

export interface CustomResourcesTreeProps {
  clusterId: string
  /** Depth of the "Custom Resources" header row; children render one/two deeper. */
  depth: number
  /** Active content-tab id — drives row highlight. */
  active: string
  isGroupOpen: (clusterId: string, gid: string) => boolean
  toggleGroup: (clusterId: string, gid: string) => void
  /** Opens a static resource list (used for "Definitions" → the `crd` list). */
  onSelect: (clusterId: string, id: string, label: string) => void
  /** Opens one CRD kind's instances view. */
  onOpenCrdKind: (clusterId: string, leaf: CrdLeaf) => void
}

const hint = (text: string) => <span className="text-faint">{text}</span>

/** The sidebar's "Custom Resources" section: the cluster's CRDs grouped by API
 *  group. Lazy — the CRD list is fetched only once the section is expanded. */
export function CustomResourcesTree({
  clusterId,
  depth,
  active,
  isGroupOpen,
  toggleGroup,
  onSelect,
  onOpenCrdKind
}: CustomResourcesTreeProps) {
  const sectionOpen = isGroupOpen(clusterId, 'crd')
  const { data: rows = [], isLoading } = useQuery({
    queryKey: qk.resource(clusterId, 'crd'),
    queryFn: () => fetchResource(clusterId, 'crd'),
    enabled: sectionOpen, // fetch only when the section is expanded
    staleTime: 60_000
  })
  const groups = useMemo(() => groupCrds(rows), [rows])

  return (
    <>
      <TreeRow
        depth={depth}
        caret={sectionOpen}
        icon="puzzle"
        label="Custom Resources"
        onToggle={() => toggleGroup(clusterId, 'crd')}
        onClick={() => toggleGroup(clusterId, 'crd')}
      />
      {sectionOpen && (
        <>
          <TreeRow
            depth={depth + 1}
            label="Definitions"
            active={active === navTabId(clusterId, 'crd')}
            onClick={() => onSelect(clusterId, 'crd', 'Custom Resources')}
          />
          {isLoading && rows.length === 0 ? (
            <TreeRow depth={depth + 1} label={hint('loading…')} />
          ) : groups.length === 0 ? (
            <TreeRow depth={depth + 1} label={hint('No custom resources')} />
          ) : (
            groups.map((g) => {
              const gid = `crd::${g.group}`
              const gOpen = isGroupOpen(clusterId, gid)
              return (
                <Fragment key={g.group}>
                  <TreeRow
                    depth={depth + 1}
                    caret={gOpen}
                    label={g.group || 'core'}
                    onToggle={() => toggleGroup(clusterId, gid)}
                    onClick={() => toggleGroup(clusterId, gid)}
                  />
                  {gOpen &&
                    g.crds.map((leaf) => (
                      <TreeRow
                        key={leaf.name}
                        depth={depth + 2}
                        label={leaf.displayName}
                        active={active === `crd:${clusterId}:${leaf.name}`}
                        onClick={() => onOpenCrdKind(clusterId, leaf)}
                      />
                    ))}
                </Fragment>
              )
            })
          )}
        </>
      )}
    </>
  )
}
