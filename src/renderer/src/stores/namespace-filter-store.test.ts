import { describe, it, expect, beforeEach } from 'vitest'
import { useNamespaceFilterStore } from './namespace-filter-store'

beforeEach(() => {
  localStorage.clear()
  // Reset the singleton store between tests.
  useNamespaceFilterStore.setState({ last: [], byTab: {} })
})

describe('namespace-filter-store', () => {
  it('setFor updates last, byTab, and persists the selection', () => {
    useNamespaceFilterStore.getState().setFor('tab-1', ['checkout', 'payments'])
    const s = useNamespaceFilterStore.getState()
    expect(s.last).toEqual(['checkout', 'payments'])
    expect(s.byTab['tab-1']).toEqual(['checkout', 'payments'])
    expect(JSON.parse(localStorage.getItem('lightship-namespace-filter')!)).toEqual([
      'checkout',
      'payments'
    ])
  })

  it('seed pins last onto a tab once, idempotently', () => {
    useNamespaceFilterStore.setState({ last: ['search'], byTab: {} })
    useNamespaceFilterStore.getState().seed('tab-2')
    expect(useNamespaceFilterStore.getState().byTab['tab-2']).toEqual(['search'])

    // A second seed must not overwrite an existing per-tab selection.
    useNamespaceFilterStore.getState().setFor('tab-2', ['platform'])
    useNamespaceFilterStore.setState({ last: ['something-else'] })
    useNamespaceFilterStore.getState().seed('tab-2')
    expect(useNamespaceFilterStore.getState().byTab['tab-2']).toEqual(['platform'])
  })

  it('pruneTo drops entries for tabs that no longer exist', () => {
    const store = useNamespaceFilterStore.getState()
    store.setFor('tab-a', ['a'])
    store.setFor('tab-b', ['b'])
    store.setFor('tab-c', ['c'])

    useNamespaceFilterStore.getState().pruneTo(['tab-a', 'tab-c'])
    const byTab = useNamespaceFilterStore.getState().byTab
    expect(Object.keys(byTab).sort()).toEqual(['tab-a', 'tab-c'])
    expect(byTab['tab-b']).toBeUndefined()
  })
})
