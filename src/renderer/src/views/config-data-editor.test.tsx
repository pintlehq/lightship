import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ConfigDataEditor } from './config-data-editor'

const configData = vi.hoisted(() => ({
  data: { OTHER: 'other-value', TOKEN: 'supersecret' },
  binaryKeys: []
}))

vi.mock('../queries/use-lightship-data', () => ({
  useConfigData: () => ({
    data: configData,
    isLoading: false,
    isError: false
  }),
  useApplyConfigData: () => ({ mutate: vi.fn(), isPending: false, isError: false })
}))

const refTarget = { kind: 'secrets', namespace: 'default', name: 'app-credentials' }

describe('ConfigDataEditor search', () => {
  it('does not mount a Secret value editor or search panel until revealed', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ConfigDataEditor clusterId="cluster-a" refTarget={refTarget} secret />
    )

    expect(screen.getByText('Value hidden')).toBeInTheDocument()
    expect(container.querySelector('.cm-editor')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Reveal to view / edit' }))
    const editor = container.querySelector('.cm-content')
    expect(editor).not.toBeNull()
    fireEvent.keyDown(editor as HTMLElement, { key: 'f', code: 'KeyF', ctrlKey: true })
    expect(screen.getByRole('search', { name: 'Find in editor' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Hide value' }))
    expect(container.querySelector('.cm-editor')).toBeNull()
    expect(screen.queryByRole('search', { name: 'Find in editor' })).not.toBeInTheDocument()
  })

  it('resets search when the selected data key changes', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ConfigDataEditor clusterId="cluster-a" refTarget={refTarget} secret={false} />
    )

    const editor = container.querySelector('.cm-content')
    fireEvent.keyDown(editor as HTMLElement, { key: 'f', code: 'KeyF', ctrlKey: true })
    expect(screen.getByRole('search', { name: 'Find in editor' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'TOKEN' }))
    expect(screen.queryByRole('search', { name: 'Find in editor' })).not.toBeInTheDocument()
  })
})
