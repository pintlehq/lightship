import type { ConfigData } from '../../../shared/ipc-types'

export type MergeCell = { type: 'absent' } | { type: 'binary' } | { type: 'text'; value: string }

export type MergeChoice = 'mine' | 'latest'

export interface MergeEntry {
  key: string
  base: MergeCell
  mine: MergeCell
  latest: MergeCell
  automatic: MergeCell | null
  canKeepMine: boolean
}

const ABSENT: MergeCell = { type: 'absent' }
const BINARY: MergeCell = { type: 'binary' }

function cell(data: Record<string, string>, binaryKeys: string[], key: string): MergeCell {
  if (binaryKeys.includes(key)) return BINARY
  return Object.hasOwn(data, key) ? { type: 'text', value: data[key] } : ABSENT
}

function equal(a: MergeCell, b: MergeCell): boolean {
  return a.type === b.type && (a.type !== 'text' || (b.type === 'text' && a.value === b.value))
}

/** Three-way key merge. Binary values are opaque and always retained from the latest read. */
export function mergeEntries(
  base: ConfigData,
  draft: Record<string, string>,
  latest: ConfigData
): MergeEntry[] {
  const keys = new Set([
    ...Object.keys(base.data),
    ...base.binaryKeys,
    ...Object.keys(draft),
    ...Object.keys(latest.data),
    ...latest.binaryKeys
  ])
  return [...keys]
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const before = cell(base.data, base.binaryKeys, key)
      const mine = cell(draft, base.binaryKeys, key)
      const remote = cell(latest.data, latest.binaryKeys, key)
      let automatic: MergeCell | null = null
      if (equal(mine, before)) automatic = remote
      else if (equal(remote, before) || equal(mine, remote)) automatic = mine
      return {
        key,
        base: before,
        mine,
        latest: remote,
        automatic,
        canKeepMine: remote.type !== 'binary'
      }
    })
}

export function mergedTextData(
  entries: MergeEntry[],
  choices: Record<string, MergeChoice>
): Record<string, string> | null {
  if (
    entries.some(
      (entry) =>
        entry.automatic === null &&
        (!choices[entry.key] || (choices[entry.key] === 'mine' && !entry.canKeepMine))
    )
  ) {
    return null
  }
  return Object.fromEntries(
    entries.flatMap((entry) => {
      const chosen = entry.automatic ?? (choices[entry.key] === 'mine' ? entry.mine : entry.latest)
      return chosen.type === 'text' ? [[entry.key, chosen.value]] : []
    })
  )
}
