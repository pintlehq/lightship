import { create } from 'zustand'

import type { ActivityRecord } from '../../../shared/ipc-types'
import { activityApi } from '../lib/ipc'

interface ActivityState {
  records: ActivityRecord[] // newest first
  hydrated: boolean
  /** Load persisted history once at startup (idempotent). */
  hydrate: () => Promise<void>
  /** Re-read from disk (e.g. when the History tab is opened). */
  refresh: () => Promise<void>
  /** Add a just-recorded entry to the front so an open History tab updates live. */
  prepend: (rec: ActivityRecord) => void
  /** Erase the history (disk + memory). */
  clear: () => Promise<void>
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  records: [],
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return
    set({ records: await activityApi.list(), hydrated: true })
  },
  refresh: async () => set({ records: await activityApi.list() }),
  prepend: (rec) => set((s) => ({ records: [rec, ...s.records] })),
  clear: async () => {
    await activityApi.clear()
    set({ records: [] })
  }
}))
