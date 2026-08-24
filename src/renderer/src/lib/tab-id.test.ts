import { describe, it, expect } from 'vitest'
import { clusterTabId } from './tab-id'

describe('clusterTabId', () => {
  it('prefixes the cluster id so the same view in two clusters is distinct', () => {
    expect(clusterTabId('c1', 'pods')).toBe('c1:pods')
    expect(clusterTabId('c2', 'pods')).toBe('c2:pods')
    expect(clusterTabId('c1', 'pods')).not.toBe(clusterTabId('c2', 'pods'))
  })

  it('works for composite ids', () => {
    expect(clusterTabId('c1', 'deployments:uid-9')).toBe('c1:deployments:uid-9')
  })
})
