import { describe, it, expect } from 'vitest'
import { qk } from './keys'

describe('qk (lightship query keys)', () => {
  it('normalizes missing cluster ids to null', () => {
    expect(qk.pods()).toEqual(['pods', null])
    expect(qk.pods(undefined)).toEqual(['pods', null])
    expect(qk.nodes('prod')).toEqual(['nodes', 'prod'])
    expect(qk.overviewBundle()).toEqual(['overview-bundle', null])
    expect(qk.overviewBundle('prod')).toEqual(['overview-bundle', 'prod'])
  })

  it('builds resource keys', () => {
    expect(qk.resource('prod', 'services')).toEqual(['resource', 'prod', 'services'])
    expect(qk.resource(null, 'services')).toEqual(['resource', null, 'services'])
  })

  it('builds yaml keys from a resource ref, normalizing optional namespace', () => {
    expect(qk.yaml('prod', { kind: 'Pod', namespace: 'checkout', name: 'api' })).toEqual([
      'yaml',
      'prod',
      'Pod',
      'checkout',
      'api'
    ])
    expect(qk.yaml('prod', { kind: 'Node', name: 'ip-1' })).toEqual([
      'yaml',
      'prod',
      'Node',
      null,
      'ip-1'
    ])
  })

  it('builds events keys, normalizing a missing ref entirely', () => {
    expect(qk.events('prod')).toEqual(['events', 'prod', null, null, null])
    expect(qk.events('prod', { kind: 'Pod', namespace: 'checkout', name: 'api' })).toEqual([
      'events',
      'prod',
      'Pod',
      'checkout',
      'api'
    ])
  })
})
