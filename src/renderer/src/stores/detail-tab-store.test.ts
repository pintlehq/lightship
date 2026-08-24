import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the backend bridge so the store's persistence is observable/controllable.
const mocks = vi.hoisted(() => ({
  getDetailTabs: vi.fn(),
  setDetailTab: vi.fn()
}))
vi.mock('../lib/ipc', () => ({ uiStateApi: mocks }))

import { useDetailTabStore } from './detail-tab-store'

beforeEach(() => {
  mocks.getDetailTabs.mockReset().mockResolvedValue({})
  mocks.setDetailTab.mockReset().mockResolvedValue(undefined)
  // Reset the singleton store between tests.
  useDetailTabStore.setState({ byKey: {}, hydrated: false })
})

describe('detail-tab-store', () => {
  it('hydrate loads byKey from the backend and marks hydrated', async () => {
    mocks.getDetailTabs.mockResolvedValue({ 'c1|pods|default|web': 'logs' })

    await useDetailTabStore.getState().hydrate()

    const s = useDetailTabStore.getState()
    expect(s.byKey).toEqual({ 'c1|pods|default|web': 'logs' })
    expect(s.hydrated).toBe(true)
  })

  it('hydrate is idempotent — a second call does not re-fetch', async () => {
    await useDetailTabStore.getState().hydrate()
    await useDetailTabStore.getState().hydrate()
    expect(mocks.getDetailTabs).toHaveBeenCalledTimes(1)
  })

  it('setFor updates byKey optimistically and writes through exactly once', () => {
    useDetailTabStore.getState().setFor('c1|deployments|prod|api', 'yaml')

    expect(useDetailTabStore.getState().byKey['c1|deployments|prod|api']).toBe('yaml')
    expect(mocks.setDetailTab).toHaveBeenCalledTimes(1)
    expect(mocks.setDetailTab).toHaveBeenCalledWith('c1|deployments|prod|api', 'yaml')
  })

  it('hydrate with no backend leaves byKey empty and does not throw', async () => {
    mocks.getDetailTabs.mockResolvedValue({})
    await expect(useDetailTabStore.getState().hydrate()).resolves.toBeUndefined()
    expect(useDetailTabStore.getState().byKey).toEqual({})
  })
})
