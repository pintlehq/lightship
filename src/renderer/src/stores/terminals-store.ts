import { create } from 'zustand'
import { reorderById } from '@renderer/ui/lib/reorder'
import type { TabbarReorderPlacement } from '@renderer/ui/lib/types'

import { useUiStore } from './ui-store'

export interface TerminalSessionMeta {
  id: string
  clusterId: string
  clusterName: string
  /** Exec target — when set, the session is a `kubectl exec` into this pod. */
  namespace?: string
  pod?: string
  container?: string
  /** Tab label (defaults to clusterName for plain kube-shells). */
  title?: string
}

interface TerminalsState {
  sessions: TerminalSessionMeta[]
  activeId: string | null
  /** True while keyboard focus is inside the terminal panel (routes ⌘W). */
  focused: boolean
  /** Open a new session for a cluster (or a pod exec) and make it active. */
  newSession: (session: Omit<TerminalSessionMeta, 'id'>) => void
  closeSession: (id: string) => void
  closeOthers: (id: string) => void
  closeToRight: (id: string) => void
  closeAll: () => void
  reorderSessions: (draggedId: string, targetId: string, placement: TabbarReorderPlacement) => void
  setActive: (id: string) => void
  setFocused: (focused: boolean) => void
}

let seq = 0

export const useTerminalsStore = create<TerminalsState>((set, get) => ({
  sessions: [],
  activeId: null,
  focused: false,
  newSession: (session) =>
    set((s) => {
      const id = `term-${++seq}`
      return { sessions: [...s.sessions, { id, ...session }], activeId: id }
    }),
  closeSession: (id) => {
    set((s) => {
      const sessions = s.sessions.filter((t) => t.id !== id)
      const activeId =
        id === s.activeId ? (sessions.length ? sessions[sessions.length - 1].id : null) : s.activeId
      return { sessions, activeId }
    })
    // Closing the last terminal hides the bottom panel.
    if (get().sessions.length === 0) useUiStore.getState().setShowTerminal(false)
  },
  closeOthers: (id) =>
    set((s) => ({ sessions: s.sessions.filter((t) => t.id === id), activeId: id })),
  closeToRight: (id) =>
    set((s) => {
      const idx = s.sessions.findIndex((t) => t.id === id)
      if (idx === -1) return s
      const sessions = s.sessions.slice(0, idx + 1)
      const activeId = sessions.some((t) => t.id === s.activeId) ? s.activeId : id
      return { sessions, activeId }
    }),
  closeAll: () => {
    set({ sessions: [], activeId: null })
    useUiStore.getState().setShowTerminal(false)
  },
  reorderSessions: (draggedId, targetId, placement) =>
    set((s) => ({ sessions: reorderById(s.sessions, draggedId, targetId, placement) })),
  setActive: (activeId) => set({ activeId }),
  setFocused: (focused) => set({ focused })
}))
