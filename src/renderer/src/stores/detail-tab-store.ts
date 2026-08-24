import { create } from 'zustand'

import { uiStateApi } from '../lib/ipc'

// Remembers the active sub-tab of each resource's detail view, keyed by
// `detailTabKey()`. Persisted to disk via the Electron backend (uiStateApi), so
// a resource reopens on the same sub-tab across content-tab switches AND app
// restarts. With no backend (plain browser) it degrades to in-memory only.
interface DetailTabState {
  /** detailTabKey() -> remembered sub-tab value. */
  byKey: Record<string, string>
  /** false until the first backend read completes. */
  hydrated: boolean
  /** Load persisted state once at startup (idempotent). */
  hydrate: () => Promise<void>
  /** Remember `tab` for `key` (optimistic local set + write-through to disk). */
  setFor: (key: string, tab: string) => void
}

export const useDetailTabStore = create<DetailTabState>((set, get) => ({
  byKey: {},
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return
    const byKey = await uiStateApi.getDetailTabs() // {} when no backend
    set({ byKey, hydrated: true })
  },
  setFor: (key, tab) => {
    set((s) => ({ byKey: { ...s.byKey, [key]: tab } }))
    void uiStateApi.setDetailTab(key, tab)
  }
}))
