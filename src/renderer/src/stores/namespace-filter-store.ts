import { create } from 'zustand'
import { z } from 'zod'

const KEY = 'lightship-namespace-filter'
const Stored = z.array(z.string()).catch([])

// The last-applied filter persists across restarts; per-tab state stays in memory.
function readInitial(): string[] {
  try {
    return Stored.parse(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
  } catch {
    return []
  }
}

interface NamespaceFilterState {
  /** Most recently applied namespace filter — seeds newly opened tabs. */
  last: string[]
  /** Per-tab namespace selection, keyed by tab id. */
  byTab: Record<string, string[]>
  /** Apply a selection to a tab and remember it as `last`. */
  setFor: (tabId: string, ns: string[]) => void
  /** Apply a selection only to one target tab without changing the remembered filter. */
  setScoped: (tabId: string, ns: string[]) => void
  /** Pin `last` onto a tab on first open (idempotent). */
  seed: (tabId: string) => void
  /** Drop entries for tabs that no longer exist. */
  pruneTo: (ids: string[]) => void
}

export const useNamespaceFilterStore = create<NamespaceFilterState>((set) => ({
  last: readInitial(),
  byTab: {},
  setFor: (tabId, ns) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(ns))
    } catch {
      /* ignore */
    }
    set((s) => ({ last: ns, byTab: { ...s.byTab, [tabId]: ns } }))
  },
  setScoped: (tabId, ns) => set((s) => ({ byTab: { ...s.byTab, [tabId]: ns } })),
  seed: (tabId) => set((s) => (tabId in s.byTab ? s : { byTab: { ...s.byTab, [tabId]: s.last } })),
  pruneTo: (ids) =>
    set((s) => {
      const next: Record<string, string[]> = {}
      for (const id of ids) if (id in s.byTab) next[id] = s.byTab[id]
      return { byTab: next }
    })
}))
