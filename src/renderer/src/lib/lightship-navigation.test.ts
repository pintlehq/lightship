import { describe, expect, it } from 'vitest'

import { lightshipNavTab, lightshipViewForNav } from './lightship-navigation'

describe('namespace navigation', () => {
  it('resolves the sidebar item to a dedicated cluster-scoped view', () => {
    expect(lightshipViewForNav('namespaces', 'Namespaces', 'cluster-a')).toEqual({
      kind: 'namespaces',
      clusterId: 'cluster-a'
    })
  })

  it('deduplicates within a cluster while keeping cluster tabs independent', () => {
    expect(lightshipNavTab('namespaces', 'Namespaces', 'a').id).toBe('a:namespaces')
    expect(lightshipNavTab('namespaces', 'Namespaces', 'b').id).toBe('b:namespaces')
  })
})
