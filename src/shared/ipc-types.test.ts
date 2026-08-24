import { describe, expect, it } from 'vitest'

import { OverviewBundleSchema, ScaleReplicasSchema } from './ipc-types'

describe('OverviewBundleSchema', () => {
  it('accepts overview and recent events in one DTO', () => {
    expect(
      OverviewBundleSchema.parse({
        overview: {
          nodes: 2,
          nodesReady: 2,
          pods: 12,
          podsCapacity: 20,
          cpuPct: null,
          memPct: 60,
          cpuReqPct: 25,
          cpuRequest: '1.0 / 4.0',
          memReqPct: 30,
          memRequest: '3.0Gi / 10.0Gi',
          namespaces: 3
        },
        events: [
          { type: 'Normal', reason: 'Started', object: 'Pod/api', message: 'Started', age: '1m' }
        ]
      })
    ).toMatchObject({
      overview: { nodes: 2 },
      events: [{ reason: 'Started' }]
    })
  })
})

describe('ScaleReplicasSchema', () => {
  it('accepts non-negative integers, including zero', () => {
    expect(ScaleReplicasSchema.parse(0)).toBe(0)
    expect(ScaleReplicasSchema.parse(3)).toBe(3)
  })

  it('rejects negative and non-integer values', () => {
    expect(() => ScaleReplicasSchema.parse(-1)).toThrow()
    expect(() => ScaleReplicasSchema.parse(1.5)).toThrow()
  })
})
