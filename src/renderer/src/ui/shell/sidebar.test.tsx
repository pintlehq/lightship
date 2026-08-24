import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { TreeRow } from './sidebar'

describe('TreeRow', () => {
  it('applies labelClassName to the label wrapper', () => {
    render(<TreeRow label="duration" labelClassName="flex-1 grid custom-label" />)

    expect(screen.getByText('duration')).toHaveClass('truncate', 'flex-1', 'grid', 'custom-label')
  })

  it('forwards refs and DOM props to the root row', () => {
    const ref = createRef<HTMLDivElement>()
    const onContextMenu = vi.fn()

    render(
      <TreeRow
        ref={ref}
        label="warehouse"
        data-testid="connection-row"
        aria-label="Connection warehouse"
        onContextMenu={onContextMenu}
      />
    )

    const row = screen.getByTestId('connection-row')
    expect(ref.current).toBe(row)
    expect(row).toHaveAttribute('aria-label', 'Connection warehouse')

    fireEvent.contextMenu(row)
    expect(onContextMenu).toHaveBeenCalledTimes(1)
  })
})
