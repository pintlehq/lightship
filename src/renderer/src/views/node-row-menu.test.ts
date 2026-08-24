import { describe, expect, it } from 'vitest'

import { buildNodeRowMenu } from './node-row-menu'

const noop = (): void => {}
const base = { onCordon: noop, onUncordon: noop, onDrain: noop }

describe('buildNodeRowMenu', () => {
  it('offers Cordon (not Uncordon) for a schedulable node', () => {
    expect(
      buildNodeRowMenu({ ...base, cordoned: false, readOnly: false }).map((i) => i.label)
    ).toEqual(['Cordon', 'Drain'])
  })

  it('offers Uncordon (not Cordon) for a cordoned node', () => {
    expect(
      buildNodeRowMenu({ ...base, cordoned: true, readOnly: false }).map((i) => i.label)
    ).toEqual(['Uncordon', 'Drain'])
  })

  it('marks Drain destructive and read-only disables every item', () => {
    const items = buildNodeRowMenu({ ...base, cordoned: false, readOnly: true })
    expect(items.find((i) => i.label === 'Drain')?.danger).toBe(true)
    expect(items.every((i) => i.disabled)).toBe(true)
  })
})
