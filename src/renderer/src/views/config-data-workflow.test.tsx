import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

import type { ConfigData, ConfigDataSaveResult, ConfigDataUpdate } from '../../../shared/ipc-types'

const mocks = vi.hoisted(() => ({
  data: null as ConfigData | null,
  mutate: vi.fn(),
  error: null as Error | null
}))

vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="Data value"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}))

vi.mock('../queries/use-lightship-data', () => ({
  useConfigData: () => ({ data: mocks.data, isLoading: false, isError: false }),
  useApplyConfigData: () => ({
    mutate: mocks.mutate,
    isPending: false,
    isError: mocks.error !== null,
    error: mocks.error
  })
}))

import { ConfigDataEditor } from './config-data-editor'

const refTarget = { kind: 'secrets', namespace: 'web', name: 'credentials' }
const snapshot = (
  data: Record<string, string>,
  resourceVersion: string,
  binaryKeys: string[] = []
): ConfigData => ({ secret: true, data, binaryKeys, resourceVersion })

function editToken(value: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'TOKEN' }))
  fireEvent.click(screen.getByRole('button', { name: 'Reveal to view / edit' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Data value' }), {
    target: { value }
  })
}

function confirmApply(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
}

beforeEach(() => {
  mocks.data = snapshot({ OTHER: 'same', TOKEN: 'old-secret' }, '10')
  mocks.mutate.mockReset()
  mocks.error = null
})

describe('ConfigDataEditor conflict recovery', () => {
  it('preserves a dirty draft and its original version across background refetches', () => {
    const view = render(<ConfigDataEditor clusterId="cluster-a" refTarget={refTarget} secret />)
    editToken('my-secret')
    mocks.data = snapshot({ OTHER: 'remote', TOKEN: 'remote-secret' }, '11')
    view.rerender(<ConfigDataEditor clusterId="cluster-a" refTarget={refTarget} secret />)
    expect(screen.getByRole('textbox', { name: 'Data value' })).toHaveValue('my-secret')
    confirmApply()
    expect(mocks.mutate.mock.calls[0][0]).toEqual({
      resourceVersion: '10',
      data: { OTHER: 'same', TOKEN: 'my-secret' }
    })
  })

  it('reviews a conflict with masked Secret values and stages a chosen merge', () => {
    const latest = snapshot(
      { OTHER: 'remote-other', TOKEN: 'remote-secret', NEW: 'new-secret' },
      '11'
    )
    const saved = snapshot({ OTHER: 'remote-other', TOKEN: 'my-secret', NEW: 'new-secret' }, '12')
    mocks.mutate.mockImplementation(
      (
        _update: ConfigDataUpdate,
        options: { onSuccess: (result: ConfigDataSaveResult) => void }
      ) => {
        options.onSuccess(
          mocks.mutate.mock.calls.length === 1
            ? { status: 'conflict', current: latest }
            : { status: 'saved', current: saved }
        )
      }
    )
    render(<ConfigDataEditor clusterId="cluster-a" refTarget={refTarget} secret />)
    editToken('my-secret')
    confirmApply()

    expect(screen.getByText('Review conflicting data changes')).toBeInTheDocument()
    const review = within(screen.getByRole('dialog'))
    expect(review.queryByText('remote-secret')).not.toBeInTheDocument()
    expect(review.queryByText('my-secret')).not.toBeInTheDocument()
    expect(screen.getByText(/1 unresolved key/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reveal Latest TOKEN' }))
    expect(screen.getByText('remote-secret')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue with merged draft' }))
    expect(screen.queryByText('Review conflicting data changes')).not.toBeInTheDocument()
    confirmApply()
    expect(mocks.mutate.mock.calls[1][0]).toEqual({
      resourceVersion: '11',
      data: { NEW: 'new-secret', OTHER: 'remote-other', TOKEN: 'my-secret' }
    })
  })

  it('keeps the draft when review closes and discards it only on explicit choice', () => {
    const latest = snapshot({ OTHER: 'same', TOKEN: 'remote-secret' }, '11')
    mocks.mutate.mockImplementation(
      (_update: ConfigDataUpdate, options: { onSuccess: (result: ConfigDataSaveResult) => void }) =>
        options.onSuccess({ status: 'conflict', current: latest })
    )
    render(<ConfigDataEditor clusterId="cluster-a" refTarget={refTarget} secret />)
    editToken('my-secret')
    confirmApply()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('textbox', { name: 'Data value' })).toHaveValue('my-secret')
    fireEvent.click(screen.getByRole('button', { name: 'Review conflict' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft and use latest' }))
    expect(screen.getByText('2 keys')).toBeInTheDocument()
    expect(screen.queryByText('unsaved changes')).not.toBeInTheDocument()
  })

  it('cancels confirmation and keeps a failed draft', () => {
    const view = render(<ConfigDataEditor clusterId="cluster-a" refTarget={refTarget} secret />)
    editToken('my-secret')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mocks.mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    mocks.error = new Error('server echoed my-secret')
    view.rerender(<ConfigDataEditor clusterId="cluster-a" refTarget={refTarget} secret />)
    expect(screen.getByRole('alert')).toHaveTextContent('Secret data save failed')
    expect(screen.queryByText('server echoed my-secret')).not.toBeInTheDocument()
  })
})
