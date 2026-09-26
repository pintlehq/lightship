import { describe, expect, it } from 'vitest'

import type { ConfigData } from '../../../shared/ipc-types'
import { mergeEntries, mergedTextData } from './config-data-merge'

const snapshot = (
  data: Record<string, string>,
  resourceVersion: string,
  binaryKeys: string[] = []
): ConfigData => ({ secret: false, data, binaryKeys, resourceVersion })

describe('ConfigData three-way merge', () => {
  it('keeps unrelated remote additions and deletions with local edits', () => {
    const base = snapshot({ A: 'one', B: 'two' }, '1')
    const latest = snapshot({ A: 'one', C: 'remote' }, '2')
    const entries = mergeEntries(base, { A: 'mine', B: 'two' }, latest)
    expect(mergedTextData(entries, {})).toEqual({ A: 'mine', C: 'remote' })
  })

  it('requires a choice for divergent edits and deletions', () => {
    const base = snapshot({ A: 'one', B: 'two' }, '1')
    const latest = snapshot({ A: 'remote', B: 'remote' }, '2')
    const entries = mergeEntries(base, { A: 'mine' }, latest)
    expect(mergedTextData(entries, {})).toBeNull()
    expect(mergedTextData(entries, { A: 'mine', B: 'latest' })).toEqual({
      A: 'mine',
      B: 'remote'
    })
    expect(mergedTextData(entries, { A: 'latest', B: 'mine' })).toEqual({ A: 'remote' })
  })

  it('accepts identical concurrent values without a choice', () => {
    const entries = mergeEntries(
      snapshot({ A: 'old' }, '1'),
      { A: 'new' },
      snapshot({ A: 'new' }, '2')
    )
    expect(mergedTextData(entries, {})).toEqual({ A: 'new' })
  })

  it('marks remote binary collisions as unresolvable with local text', () => {
    const entries = mergeEntries(
      snapshot({ A: 'old' }, '1'),
      { A: 'mine' },
      snapshot({}, '2', ['A'])
    )
    expect(entries[0]).toMatchObject({ key: 'A', automatic: null, canKeepMine: false })
    expect(mergedTextData(entries, { A: 'latest' })).toEqual({})
  })
})
