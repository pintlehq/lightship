import { create } from 'zustand'
import { reorderById } from '@renderer/ui/lib/reorder'
import type { TabItem, TabbarReorderPlacement } from '@renderer/ui/lib/types'

import type { LightshipView } from '../types'

export type LightshipTab = TabItem<LightshipView>

interface TabsState {
  tabs: LightshipTab[]
  activeTab: string | null
  openTab: (tab: LightshipTab) => void
  closeTab: (id: string) => void
  /** Close every tab pinned to a cluster (e.g. when the cluster is removed). */
  closeTabsForCluster: (clusterId: string) => void
  closeOthers: (id: string) => void
  closeToRight: (id: string) => void
  closeAll: () => void
  reorderTabs: (draggedId: string, targetId: string, placement: TabbarReorderPlacement) => void
  selectTab: (id: string) => void
}

const INITIAL_TABS: LightshipTab[] = []

export const useTabsStore = create<TabsState>((set) => ({
  tabs: INITIAL_TABS,
  activeTab: null,
  openTab: (tab) =>
    set((s) => ({
      tabs: s.tabs.some((t) => t.id === tab.id) ? s.tabs : [...s.tabs, tab],
      activeTab: tab.id
    })),
  closeTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id)
      const activeTab =
        id === s.activeTab ? (tabs.length ? tabs[tabs.length - 1].id : null) : s.activeTab
      return { tabs, activeTab }
    }),
  closeTabsForCluster: (clusterId) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => !('clusterId' in t.view && t.view.clusterId === clusterId))
      const activeTab = tabs.some((t) => t.id === s.activeTab)
        ? s.activeTab
        : tabs.length
          ? tabs[tabs.length - 1].id
          : null
      return { tabs, activeTab }
    }),
  closeOthers: (id) => set((s) => ({ tabs: s.tabs.filter((t) => t.id === id), activeTab: id })),
  closeToRight: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      if (idx === -1) return s
      const tabs = s.tabs.slice(0, idx + 1)
      const activeTab = tabs.some((t) => t.id === s.activeTab) ? s.activeTab : id
      return { tabs, activeTab }
    }),
  closeAll: () => set({ tabs: [], activeTab: null }),
  reorderTabs: (draggedId, targetId, placement) =>
    set((s) => ({ tabs: reorderById(s.tabs, draggedId, targetId, placement) })),
  selectTab: (id) => set({ activeTab: id })
}))
