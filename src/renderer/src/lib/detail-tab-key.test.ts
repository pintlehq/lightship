import { describe, it, expect } from 'vitest'
import { detailTabKey, resolveDetailTab } from './detail-tab-key'

describe('detailTabKey', () => {
  it('builds a pipe-separated key from cluster/kind/namespace/name', () => {
    expect(detailTabKey('c1', 'deployments', 'prod', 'api')).toBe('c1|deployments|prod|api')
  })

  it('uses an empty namespace segment for cluster-scoped resources', () => {
    expect(detailTabKey('c1', 'nodes', undefined, 'node-1')).toBe('c1|nodes||node-1')
  })

  it('uses an empty cluster segment when no cluster is active', () => {
    expect(detailTabKey(null, 'pods', 'default', 'web')).toBe('|pods|default|web')
  })
})

describe('resolveDetailTab', () => {
  const available = ['overview', 'yaml', 'events']

  it('returns the remembered tab when it is still available', () => {
    expect(resolveDetailTab('yaml', available)).toBe('yaml')
  })

  it('falls back to overview when the remembered tab is unavailable', () => {
    expect(resolveDetailTab('logs', available)).toBe('overview')
  })

  it('falls back to overview when nothing is remembered', () => {
    expect(resolveDetailTab(undefined, available)).toBe('overview')
  })
})
