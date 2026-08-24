import { describe, expect, it } from 'vitest'

import type { WatchDelta } from '../../../shared/ipc-types'
import { applyDeltas } from './live-cache'

type Row = { id: string; v: number }
const keyOf = (r: Row): string => r.id
const delta = (op: WatchDelta['op'], row: Row): WatchDelta => ({
  op,
  row: row as unknown as WatchDelta['row']
})

describe('applyDeltas', () => {
  it('builds a fresh list when prev is undefined', () => {
    expect(applyDeltas<Row>(undefined, [delta('added', { id: 'a', v: 1 })], keyOf)).toEqual([
      { id: 'a', v: 1 }
    ])
  })

  it('upserts modified rows by identity, preserving order', () => {
    const prev = [
      { id: 'a', v: 1 },
      { id: 'b', v: 2 }
    ]
    expect(applyDeltas<Row>(prev, [delta('modified', { id: 'a', v: 9 })], keyOf)).toEqual([
      { id: 'a', v: 9 },
      { id: 'b', v: 2 }
    ])
  })

  it('appends newly added rows after existing ones', () => {
    const out = applyDeltas<Row>([{ id: 'a', v: 1 }], [delta('added', { id: 'b', v: 2 })], keyOf)
    expect(out.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('removes deleted rows', () => {
    const prev = [
      { id: 'a', v: 1 },
      { id: 'b', v: 2 }
    ]
    expect(applyDeltas<Row>(prev, [delta('deleted', { id: 'a', v: 1 })], keyOf)).toEqual([
      { id: 'b', v: 2 }
    ])
  })

  it('applies a mixed batch in order', () => {
    const out = applyDeltas<Row>(
      [{ id: 'a', v: 1 }],
      [
        delta('added', { id: 'b', v: 2 }),
        delta('modified', { id: 'a', v: 5 }),
        delta('deleted', { id: 'b', v: 2 })
      ],
      keyOf
    )
    expect(out).toEqual([{ id: 'a', v: 5 }])
  })
})
