import { create } from 'zustand'
import { toast } from '@renderer/ui/components/toaster'

import type { ActivityInput, ActivityRecord } from '../../../shared/ipc-types'
import { activityApi } from '../lib/ipc'

export interface PendingActivity {
  id: string
  input: ActivityInput
  retrying: boolean
}

interface ActivityState {
  records: ActivityRecord[] // newest first
  pending: PendingActivity[] // unsaved, in memory only
  hydrated: boolean
  /** Load persisted history once at startup (idempotent). */
  hydrate: () => Promise<void>
  /** Re-read from disk (e.g. when the History tab is opened). */
  refresh: () => Promise<void>
  /** Add a just-recorded entry to the front so an open History tab updates live. */
  prepend: (rec: ActivityRecord) => void
  enqueueFailed: (input: ActivityInput) => void
  retryFailed: (id: string) => Promise<void>
  discardFailed: (id: string) => void
  /** Erase the history (disk + memory). */
  clear: () => Promise<void>
}

let pendingSeq = 0

export const useActivityStore = create<ActivityState>((set, get) => ({
  records: [],
  pending: [],
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return
    try {
      set({ records: await activityApi.list(), hydrated: true })
    } catch {
      toast.error(
        'Activity history unavailable',
        'Could not load saved activity. Try reopening History.'
      )
    }
  },
  refresh: async () => {
    try {
      set({ records: await activityApi.list() })
    } catch {
      toast.error('Activity history unavailable', 'Could not refresh saved activity.')
    }
  },
  prepend: (rec) => set((s) => ({ records: [rec, ...s.records] })),
  enqueueFailed: (input) => {
    const id = `pending-${Date.now()}-${++pendingSeq}`
    set((s) => ({ pending: [{ id, input, retrying: false }, ...s.pending] }))
  },
  retryFailed: async (id) => {
    const entry = get().pending.find((item) => item.id === id)
    if (!entry || entry.retrying) return
    set((s) => ({
      pending: s.pending.map((item) => (item.id === id ? { ...item, retrying: true } : item))
    }))
    try {
      const record = await activityApi.record(entry.input)
      if (!record) throw new Error('Activity backend unavailable')
      let retained = false
      set((s) => {
        retained = s.pending.some((item) => item.id === id)
        return {
          pending: s.pending.filter((item) => item.id !== id),
          records: retained ? [record, ...s.records] : s.records
        }
      })
      if (retained) toast.success('Activity history saved')
    } catch {
      set((s) => ({
        pending: s.pending.map((item) => (item.id === id ? { ...item, retrying: false } : item))
      }))
      toast.error(
        'Activity history unavailable',
        'Retry failed. The Kubernetes action was not repeated.'
      )
    }
  },
  discardFailed: (id) => set((s) => ({ pending: s.pending.filter((item) => item.id !== id) })),
  clear: async () => {
    try {
      await activityApi.clear()
      set({ records: [], pending: [] })
    } catch {
      toast.error('Activity history unavailable', 'Could not clear saved activity.')
    }
  }
}))
