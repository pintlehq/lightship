import { beforeEach, describe, expect, it } from 'vitest'

import { useTabsStore, type LightshipTab } from './tabs-store'

const tab = (id: string, view: LightshipTab['view']): LightshipTab => ({ id, label: id, view })

beforeEach(() => useTabsStore.setState({ tabs: [], activeTab: null }))

describe('closeTabsForCluster', () => {
  it('drops tabs pinned to the cluster, keeps others, re-points the active tab', () => {
    useTabsStore.setState({
      tabs: [
        tab('c1-pods', { kind: 'pods', clusterId: 'c1' }),
        tab('c2-pods', { kind: 'pods', clusterId: 'c2' }),
        tab('history', { kind: 'history' })
      ],
      activeTab: 'c1-pods'
    })
    useTabsStore.getState().closeTabsForCluster('c1')
    const s = useTabsStore.getState()
    expect(s.tabs.map((t) => t.id)).toEqual(['c2-pods', 'history'])
    expect(s.activeTab).toBe('history') // active was removed → last remaining
  })

  it('leaves the active tab alone when it belongs to another cluster', () => {
    useTabsStore.setState({
      tabs: [
        tab('c1-pods', { kind: 'pods', clusterId: 'c1' }),
        tab('history', { kind: 'history' })
      ],
      activeTab: 'history'
    })
    useTabsStore.getState().closeTabsForCluster('c1')
    expect(useTabsStore.getState().activeTab).toBe('history')
  })

  it('nulls the active tab when nothing remains', () => {
    useTabsStore.setState({
      tabs: [tab('c1-pods', { kind: 'pods', clusterId: 'c1' })],
      activeTab: 'c1-pods'
    })
    useTabsStore.getState().closeTabsForCluster('c1')
    expect(useTabsStore.getState().tabs).toEqual([])
    expect(useTabsStore.getState().activeTab).toBeNull()
  })
})

describe('reorderTabs', () => {
  it('reorders tabs without changing the active tab', () => {
    useTabsStore.setState({
      tabs: [
        tab('a', { kind: 'history' }),
        tab('b', { kind: 'history' }),
        tab('c', { kind: 'history' })
      ],
      activeTab: 'b'
    })

    useTabsStore.getState().reorderTabs('c', 'a', 'before')

    const s = useTabsStore.getState()
    expect(s.tabs.map((t) => t.id)).toEqual(['c', 'a', 'b'])
    expect(s.activeTab).toBe('b')
  })

  it('closeToRight follows the reordered tab order', () => {
    useTabsStore.setState({
      tabs: [
        tab('a', { kind: 'history' }),
        tab('b', { kind: 'history' }),
        tab('c', { kind: 'history' })
      ],
      activeTab: 'a'
    })

    useTabsStore.getState().reorderTabs('c', 'a', 'before')
    useTabsStore.getState().closeToRight('c')

    const s = useTabsStore.getState()
    expect(s.tabs.map((t) => t.id)).toEqual(['c'])
    expect(s.activeTab).toBe('c')
  })
})
