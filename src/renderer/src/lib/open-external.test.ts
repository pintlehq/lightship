import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LightshipApi } from '../../../shared/ipc-types'

const mocks = vi.hoisted(() => ({ error: vi.fn(), open: vi.fn() }))
vi.mock('@renderer/ui/components/toaster', () => ({ toast: { error: mocks.error } }))

import { openExternal } from './open-external'

beforeEach(() => {
  mocks.error.mockReset()
  mocks.open.mockReset()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { window: { openExternal: mocks.open } } as unknown as LightshipApi
  })
})
afterEach(() => {
  Reflect.deleteProperty(window, 'api')
})

describe('openExternal', () => {
  it('reports rejected browser opens', async () => {
    mocks.open.mockRejectedValue(new Error('browser unavailable'))
    openExternal('http://localhost:43821')
    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith('Could not open browser', 'browser unavailable')
    )
  })

  it('reports that the desktop bridge is unavailable', () => {
    Reflect.deleteProperty(window, 'api')
    openExternal('http://localhost:43821')
    expect(mocks.error).toHaveBeenCalledWith('Could not open browser', 'Desktop app required')
  })
})
