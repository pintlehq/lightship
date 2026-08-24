import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'

import { Toaster, toast, toastManager } from './toaster'

afterEach(() => vi.restoreAllMocks())

describe('toast helpers', () => {
  it('add a typed toast via the singleton manager', () => {
    const add = vi.spyOn(toastManager, 'add')
    toast.success('Deleted 3 pods')
    toast.error('Failed to delete', 'boom')
    expect(add).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: 'success', title: 'Deleted 3 pods' })
    )
    expect(add).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'error', title: 'Failed to delete', description: 'boom' })
    )
  })
})

describe('Toaster', () => {
  it('mounts without crashing', () => {
    expect(() => render(<Toaster />)).not.toThrow()
  })
})
