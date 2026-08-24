import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ResourceRef, ResourceRow } from '../../../shared/ipc-types'
import { ScaleResourceDialog } from './scale-resource-dialog'

const row: ResourceRow = {
  uid: 'web/api',
  namespace: 'web',
  name: 'api',
  age: '3d',
  columns: { ready: '2/3' }
}

const rowTwo: ResourceRow = {
  uid: 'web/worker',
  namespace: 'web',
  name: 'worker',
  age: '2d',
  columns: { ready: '3/3' }
}

function renderDialog({
  onScale,
  rows,
  resourceLabel,
  onComplete
}: {
  onScale?: (ref: ResourceRef, replicas: number) => Promise<void>
  rows?: ResourceRow[]
  resourceLabel?: string
  onComplete?: () => void
} = {}) {
  const qc = new QueryClient()
  const onClose = vi.fn()
  const scale = onScale ?? vi.fn(() => Promise.resolve())
  render(
    <QueryClientProvider client={qc}>
      <ScaleResourceDialog
        clusterId="cluster-a"
        resourceId="deployments"
        resourceLabel={resourceLabel}
        row={rows ? undefined : row}
        rows={rows}
        open
        onClose={onClose}
        onComplete={onComplete}
        onScale={scale}
      />
    </QueryClientProvider>
  )
  return { onScale: scale, onClose }
}

describe('ScaleResourceDialog', () => {
  it('initializes from the desired replica count in READY', () => {
    renderDialog()
    expect(screen.getByLabelText('Replicas')).toHaveValue('3')
  })

  it('accepts zero and submits the intended replica count', async () => {
    const user = userEvent.setup()
    const { onScale, onClose } = renderDialog()
    const input = screen.getByLabelText('Replicas')

    await user.clear(input)
    await user.type(input, '0')
    await user.click(screen.getByRole('button', { name: 'Scale' }))

    await waitFor(() => expect(onScale).toHaveBeenCalledOnce())
    expect(onScale).toHaveBeenCalledWith({ kind: 'deployments', namespace: 'web', name: 'api' }, 0)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('blocks empty, negative, and decimal values', async () => {
    const user = userEvent.setup()
    renderDialog()
    const input = screen.getByLabelText('Replicas')
    const button = screen.getByRole('button', { name: 'Scale' })

    await user.clear(input)
    expect(button).toBeDisabled()

    await user.type(input, '-1')
    expect(button).toBeDisabled()

    await user.clear(input)
    await user.type(input, '1.5')
    expect(button).toBeDisabled()
  })

  it('shows the selected count in bulk mode', () => {
    renderDialog({ rows: [row, rowTwo], resourceLabel: 'Deployments' })

    expect(screen.getByText('2 deployments selected')).toBeInTheDocument()
  })

  it('prefills bulk mode when every selected row has the same desired replica count', () => {
    renderDialog({
      rows: [
        { ...row, uid: 'web/api-a', name: 'api-a', columns: { ready: '1/4' } },
        { ...row, uid: 'web/api-b', name: 'api-b', columns: { ready: '3/4' } }
      ]
    })

    expect(screen.getByLabelText('Replicas')).toHaveValue('4')
  })

  it('leaves bulk mode blank when selected rows have different desired replica counts', () => {
    renderDialog({ rows: [row, { ...rowTwo, columns: { ready: '1/5' } }] })

    expect(screen.getByLabelText('Replicas')).toHaveValue('')
  })

  it('submits bulk scale once per selected row', async () => {
    const user = userEvent.setup()
    const { onScale, onClose } = renderDialog({ rows: [row, rowTwo] })
    const input = screen.getByLabelText('Replicas')

    await user.clear(input)
    await user.type(input, '6')
    await user.click(screen.getByRole('button', { name: 'Scale' }))

    await waitFor(() => expect(onScale).toHaveBeenCalledTimes(2))
    expect(onScale).toHaveBeenNthCalledWith(
      1,
      { kind: 'deployments', namespace: 'web', name: 'api' },
      6
    )
    expect(onScale).toHaveBeenNthCalledWith(
      2,
      { kind: 'deployments', namespace: 'web', name: 'worker' },
      6
    )
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onComplete after a successful bulk scale', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    renderDialog({ rows: [row, rowTwo], onComplete })

    await user.clear(screen.getByLabelText('Replicas'))
    await user.type(screen.getByLabelText('Replicas'), '5')
    await user.click(screen.getByRole('button', { name: 'Scale' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
  })
})
