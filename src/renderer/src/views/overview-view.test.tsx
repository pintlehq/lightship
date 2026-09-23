import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { OverviewView } from './overview-view'

const mocks = vi.hoisted(() => ({ refetch: vi.fn() }))

vi.mock('../queries/use-lightship-data', () => ({
  useOverviewBundle: () => ({
    data: undefined,
    dataUpdatedAt: 0,
    isError: true,
    error: new Error('Forbidden: cannot list nodes'),
    isPending: false,
    isFetching: false,
    refetch: mocks.refetch
  })
}))

it('shows the overview request error and offers a retry', async () => {
  const user = userEvent.setup()
  render(<OverviewView clusterId="c1" />)

  expect(screen.getByText('Forbidden: cannot list nodes')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(mocks.refetch).toHaveBeenCalledOnce()
})
