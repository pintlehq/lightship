import { describe, expect, it } from 'vitest'

import { reorderById } from './reorder'

const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }))

describe('reorderById', () => {
  it('moves an item before the target', () => {
    expect(reorderById(items, 'd', 'b', 'before').map((item) => item.id)).toEqual([
      'a',
      'd',
      'b',
      'c'
    ])
  })

  it('moves an item after the target', () => {
    expect(reorderById(items, 'a', 'c', 'after').map((item) => item.id)).toEqual([
      'b',
      'c',
      'a',
      'd'
    ])
  })

  it('moves left-to-right and right-to-left', () => {
    expect(reorderById(items, 'b', 'd', 'after').map((item) => item.id)).toEqual([
      'a',
      'c',
      'd',
      'b'
    ])
    expect(reorderById(items, 'c', 'a', 'before').map((item) => item.id)).toEqual([
      'c',
      'a',
      'b',
      'd'
    ])
  })

  it('returns the original array for invalid or same-id drops', () => {
    expect(reorderById(items, 'x', 'a', 'before')).toBe(items)
    expect(reorderById(items, 'a', 'x', 'before')).toBe(items)
    expect(reorderById(items, 'a', 'a', 'before')).toBe(items)
  })

  it('returns the original array for no-op moves', () => {
    expect(reorderById(items, 'b', 'c', 'before')).toBe(items)
    expect(reorderById(items, 'c', 'b', 'after')).toBe(items)
  })

  it('preserves moved item identity', () => {
    const next = reorderById(items, 'd', 'a', 'before')
    expect(next[0]).toBe(items[3])
  })
})
