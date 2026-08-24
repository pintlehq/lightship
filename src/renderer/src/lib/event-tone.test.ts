import { describe, it, expect } from 'vitest'
import { eventTone } from './event-tone'

describe('eventTone', () => {
  it('maps non-warning events to info', () => {
    expect(eventTone({ type: 'Normal', reason: 'Scheduled' })).toBe('info')
    expect(eventTone({ type: 'Normal', reason: 'BackOff' })).toBe('info')
  })

  it('maps warning events with a failure reason to destructive', () => {
    for (const reason of ['BackOff', 'Failed', 'Unhealthy', 'Error', 'FailedMount']) {
      expect(eventTone({ type: 'Warning', reason })).toBe('destructive')
    }
  })

  it('maps other warning events to warning', () => {
    expect(eventTone({ type: 'Warning', reason: 'Evicted' })).toBe('warning')
    expect(eventTone({ type: 'Warning', reason: 'NodeNotReady' })).toBe('warning')
  })
})
