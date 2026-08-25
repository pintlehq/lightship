import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import type { UiState } from '../../shared/ipc-types'
import { UiStateSchema } from '../../shared/ipc-types'
import { parseOrFallback } from '../../shared/validate'

// Non-sensitive renderer UI state, persisted alongside clusters.json under
// userData/Clusters. No safeStorage — there are no credentials here.
const baseDir = () => join(app.getPath('userData'), 'Clusters')
const stateFile = () => join(baseDir(), 'ui-state.json')

const EMPTY: UiState = { detailTabs: {} }

// Per-resource keys accumulate forever; cap the map (rough LRU — a touched key
// is moved to the tail on write) so the file can't grow without bound.
const MAX_DETAIL_TABS = 500

export async function readUiState(): Promise<UiState> {
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(stateFile(), 'utf8'))
  } catch {
    return { detailTabs: {} } // missing / unreadable file
  }
  // A corrupt ui-state.json must never crash startup — fall back to empty.
  return parseOrFallback(UiStateSchema, raw, EMPTY, 'ui-state.json')
}

async function writeUiState(state: UiState): Promise<void> {
  await fs.mkdir(baseDir(), { recursive: true })
  await fs.writeFile(stateFile(), JSON.stringify(state, null, 2), 'utf8')
}

/** Remember the active sub-tab for one resource. */
export async function setDetailTab(key: string, tab: string): Promise<void> {
  const state = await readUiState()
  // Delete-then-reassign so the touched key moves to the tail (recency order).
  delete state.detailTabs[key]
  let detailTabs = { ...state.detailTabs, [key]: tab }
  const keys = Object.keys(detailTabs)
  if (keys.length > MAX_DETAIL_TABS) {
    detailTabs = Object.fromEntries(Object.entries(detailTabs).slice(keys.length - MAX_DETAIL_TABS))
  }
  await writeUiState({ ...state, detailTabs })
}
