import { z } from 'zod'

import type { UiState } from '../../shared/ipc-types'
import { parseOrFallback } from '../../shared/validate'
import { readFileIfPresent, SerialQueue, storagePaths, writeJsonAtomically } from './storage'

const PersistedPreferencesSchema = z.object({
  schemaVersion: z.literal(1),
  detailTabs: z.record(z.string(), z.string())
})
const EMPTY = { schemaVersion: 1 as const, detailTabs: {} }
const writes = new SerialQueue()

// Per-resource keys accumulate forever; cap the map (rough LRU — a touched key
// is moved to the tail on write) so the file can't grow without bound.
const MAX_DETAIL_TABS = 500

async function readPreferences(): Promise<UiState> {
  const text = await readFileIfPresent(storagePaths().preferences)
  if (text === undefined) return { detailTabs: {} }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { detailTabs: {} }
  }
  const preferences = parseOrFallback(PersistedPreferencesSchema, raw, EMPTY, 'preferences.json')
  return { detailTabs: preferences.detailTabs }
}

async function writeUiState(state: UiState): Promise<void> {
  await writeJsonAtomically(storagePaths().preferences, { schemaVersion: 1, ...state })
}

export async function readUiState(): Promise<UiState> {
  await writes.wait()
  return readPreferences()
}

/** Remember the active sub-tab for one resource. */
export async function setDetailTab(key: string, tab: string): Promise<void> {
  await writes.run(async () => {
    const state = await readPreferences()
    // Delete-then-reassign so the touched key moves to the tail (recency order).
    delete state.detailTabs[key]
    let detailTabs = { ...state.detailTabs, [key]: tab }
    const keys = Object.keys(detailTabs)
    if (keys.length > MAX_DETAIL_TABS) {
      detailTabs = Object.fromEntries(
        Object.entries(detailTabs).slice(keys.length - MAX_DETAIL_TABS)
      )
    }
    await writeUiState({ ...state, detailTabs })
  })
}
