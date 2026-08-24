import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'

import { Progress } from './progress'

describe('Progress', () => {
  it('maps value/max to a clamped fill width and ARIA attrs', () => {
    const { getByRole } = render(<Progress value={3} max={10} />)
    const bar = getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '3')
    expect(bar).toHaveAttribute('aria-valuemax', '10')
    expect((bar.firstChild as HTMLElement).style.width).toBe('30%')
  })

  it('clamps an over-range value to 100%', () => {
    const bar = render(<Progress value={50} max={10} />).getByRole('progressbar')
    expect((bar.firstChild as HTMLElement).style.width).toBe('100%')
  })

  it('clamps a negative value to 0%', () => {
    const bar = render(<Progress value={-5} max={10} />).getByRole('progressbar')
    expect((bar.firstChild as HTMLElement).style.width).toBe('0%')
  })
})
