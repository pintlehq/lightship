import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConfirmDialog } from './confirm-dialog'

describe('ConfirmDialog exact-text requirement', () => {
  it('keeps the destructive action disabled until the exact text is typed', () => {
    const confirm = vi.fn()
    render(
      <ConfirmDialog
        open
        danger
        title="Delete namespace?"
        message="This cannot be undone."
        confirmationText="team-a"
        confirmLabel="Delete namespace"
        onConfirm={confirm}
        onCancel={() => undefined}
      />
    )

    const button = screen.getByRole('button', { name: 'Delete namespace' })
    const input = screen.getByRole('textbox')
    expect(button).toBeDisabled()
    fireEvent.change(input, { target: { value: 'team' } })
    expect(button).toBeDisabled()
    fireEvent.change(input, { target: { value: 'team-a' } })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(confirm).toHaveBeenCalledOnce()
  })
})
