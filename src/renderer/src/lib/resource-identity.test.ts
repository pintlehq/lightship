import { describe, expect, it } from 'vitest'
import { qk } from '../queries/keys'
import { useTabsStore } from '../stores/tabs-store'
import { detailTabKey } from './detail-tab-key'
import { resourceTabId } from './resource-identity'

describe('resource identity', () => {
  it('opens same-name pods in different namespaces separately and reuses the same resource tab', () => {
    useTabsStore.getState().closeAll()
    for (const namespace of ['web', 'jobs', 'web']) {
      useTabsStore.getState().openTab({
        id: resourceTabId('c1', { kind: 'pods', namespace, name: 'api' }),
        label: 'api',
        icon: 'box',
        view: { kind: 'pod', clusterId: 'c1', namespace, name: 'api' }
      })
    }
    expect(useTabsStore.getState().tabs).toHaveLength(2)
    expect(useTabsStore.getState().activeTab).toBe(
      resourceTabId('c1', { kind: 'pods', namespace: 'web', name: 'api' })
    )
    useTabsStore.getState().closeAll()
  })

  it('isolates custom groups/versions in tabs, cached data and remembered sub-tabs', () => {
    const versions = ['one.example/v1', 'two.example/v1', 'one.example/v2']
    const refs = versions.map((apiVersion) => ({
      kind: 'Widget',
      namespace: 'web',
      name: 'api',
      apiVersion
    }))
    for (const key of [qk.yaml, qk.detail, qk.configData, qk.events]) {
      expect(new Set(refs.map((ref) => JSON.stringify(key('c1', ref)))).size).toBe(3)
    }
    expect(new Set(refs.map((ref) => resourceTabId('c1', ref))).size).toBe(3)
    const rememberedKeys = versions.map((version) =>
      detailTabKey('c1', 'widgets', 'web', 'api', version)
    )
    expect(new Set(rememberedKeys).size).toBe(3)
    expect(rememberedKeys).not.toContain(detailTabKey('c1', 'widgets', 'web', 'api'))
  })
})
