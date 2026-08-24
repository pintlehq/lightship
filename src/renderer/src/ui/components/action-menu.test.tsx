import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ActionMenu } from './action-menu'
import type { ContextMenuItemDef } from './context-menu'

const items: ContextMenuItemDef[] = [{ label: 'Open' }, { label: 'Delete', danger: true }]

describe('ActionMenu', () => {
  it('renders the kebab trigger with an accessible label', () => {
    render(<ActionMenu items={items} label="Row actions" />)
    expect(screen.getByRole('button', { name: 'Row actions' })).toBeInTheDocument()
  })

  it('keeps the menu items closed until the trigger is activated', () => {
    render(<ActionMenu items={items} />)
    expect(screen.queryByText('Delete')).not.toBeInTheDocument()
  })
})
