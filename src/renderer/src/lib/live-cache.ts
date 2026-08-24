import type { WatchDelta } from '../../../shared/ipc-types'

/** Apply a batch of watch deltas to a cached list, keyed by a stable identity.
 *  `added`/`modified` upsert (preserving first-seen order); `deleted` removes.
 *  Pure — the renderer feeds this to `queryClient.setQueryData`. */
export function applyDeltas<T>(
  prev: T[] | undefined,
  items: WatchDelta[],
  keyOf: (row: T) => string
): T[] {
  const map = new Map<string, T>()
  for (const row of prev ?? []) map.set(keyOf(row), row)
  for (const d of items) {
    const row = d.row as T
    const key = keyOf(row)
    if (d.op === 'deleted') map.delete(key)
    else map.set(key, row)
  }
  return [...map.values()]
}
