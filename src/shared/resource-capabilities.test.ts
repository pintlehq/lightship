import { describe, expect, it } from 'vitest'

import {
  canForwardResource,
  canLogResource,
  canRestartResource,
  canScaleResource,
  resourceCapabilities
} from './resource-capabilities'

describe('resource capabilities', () => {
  it('keeps workload action visibility in one registry', () => {
    expect(canLogResource('deployments')).toBe(true)
    expect(canForwardResource('deployments')).toBe(true)
    expect(canRestartResource('deployments')).toBe(true)
    expect(canScaleResource('deployments')).toBe(true)

    expect(canRestartResource('daemonsets')).toBe(true)
    expect(canScaleResource('daemonsets')).toBe(false)
  })

  it('distinguishes log and forward-only resources', () => {
    expect(canLogResource('cronjobs')).toBe(true)
    expect(canForwardResource('cronjobs')).toBe(false)
    expect(canForwardResource('services')).toBe(true)
    expect(canLogResource('services')).toBe(false)
  })

  it('returns empty capabilities for unknown kinds', () => {
    expect(resourceCapabilities('frobs')).toEqual({})
    expect(canRestartResource('frobs')).toBe(false)
    expect(canScaleResource('frobs')).toBe(false)
  })
})
