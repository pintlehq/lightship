import { useEffect } from 'react'

import { useActivityStore } from '../stores/activity-store'
import { useDetailTabStore } from '../stores/detail-tab-store'
import { useNamespaceFilterStore } from '../stores/namespace-filter-store'
import { useTabsStore } from '../stores/tabs-store'
import { useTerminalsStore } from '../stores/terminals-store'

import type { LightshipTab } from '../stores/tabs-store'

export function useAppBootstrap(tabs: LightshipTab[]) {
  const pruneNs = useNamespaceFilterStore((s) => s.pruneTo)
  // Keep per-tab namespace filters in sync with open tabs: drop entries for tabs
  // that were closed so a reopened tab inherits the current last-applied filter.
  useEffect(() => {
    pruneNs(tabs.map((t) => t.id))
  }, [tabs, pruneNs])

  // Load persisted per-resource sub-tab selections once at startup. Cheap local
  // file read; resolves long before the user opens any resource detail (tabs
  // don't persist, so nothing is mounted at cold start).
  useEffect(() => {
    void useDetailTabStore.getState().hydrate()
    void useActivityStore.getState().hydrate()
  }, [])

  // ⌘W closes the focused terminal session first; else the active tab; once no
  // tabs remain it closes the window.
  useEffect(() => {
    return window.api?.window?.onCloseTab(() => {
      const term = useTerminalsStore.getState()
      if (term.focused && term.activeId) {
        term.closeSession(term.activeId)
        return
      }
      const { activeTab, closeTab } = useTabsStore.getState()
      if (activeTab) closeTab(activeTab)
      else void window.api.window.close()
    })
  }, [])
}
