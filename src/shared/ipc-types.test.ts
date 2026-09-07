import { describe, expect, it } from 'vitest'

import {
  isValidLabelKey,
  isValidLabelValue,
  isValidNamespaceName,
  NamespaceCreateInputSchema,
  OverviewBundleSchema,
  ScaleReplicasSchema
} from './ipc-types'

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

describe('namespace input validation', () => {
  it('validates RFC 1123 namespace names', () => {
    expect(isValidNamespaceName('team-production')).toBe(true)
    expect(isValidNamespaceName('Team_Production')).toBe(false)
    expect(isValidNamespaceName('-team')).toBe(false)
  })

  it('validates Kubernetes label keys and values', () => {
    expect(isValidLabelKey('app.kubernetes.io/name')).toBe(true)
    expect(isValidLabelKey('bad prefix/name')).toBe(false)
    expect(isValidLabelValue('')).toBe(true)
    expect(isValidLabelValue('platform_team')).toBe(true)
  })

  it('accepts form or YAML creation and rejects invalid labels', () => {
    expect(
      NamespaceCreateInputSchema.parse({
        mode: 'form',
        name: 'team-a',
        labels: { team: 'platform' }
      }).mode
    ).toBe('form')
    expect(NamespaceCreateInputSchema.parse({ mode: 'yaml', yaml: 'kind: Namespace' }).mode).toBe(
      'yaml'
    )
    expect(() =>
      NamespaceCreateInputSchema.parse({ mode: 'form', name: 'team-a', labels: { 'bad key': 'x' } })
    ).toThrow()
  })
})
