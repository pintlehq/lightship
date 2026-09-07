import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { NamespaceDetail } from '../../../shared/ipc-types'

const detail: NamespaceDetail = {
  summary: {
    name: 'team-a',
    uid: 'team-a',
    status: 'Active',
    created: '2026-09-07T00:00:00.000Z',
    age: '1d',
    protected: false,
    podsReady: 1,
    podsTotal: 1,
    quotaCount: 0,
    limitRangeCount: 0,
    networkPolicyCount: 0,
    defaultDenyIngress: false,
    defaultDenyEgress: false
  },
  labels: {},
  annotations: {},
  finalizers: [],
  podStates: {
    total: 1,
    ready: 1,
    running: 1,
    pending: 0,
    succeeded: 0,
    failed: 0,
    unknown: 0
  },
  quotas: [],
  limitRanges: [],
  networkPolicies: [],
  access: {
    pods: { available: true },
    quotas: { available: true },
    limits: { available: true },
    policies: { available: true }
  }
}

vi.mock('../queries/use-lightship-data', () => ({
  useNamespaceDetail: () => ({ data: detail, isLoading: false, isError: false }),
  useEvents: () => ({ data: [] })
}))

import { NamespaceDetailView } from './namespace-detail-view'

describe('NamespaceDetailView', () => {
  it('shows all detail sections without exposing namespace deletion', () => {
    render(<NamespaceDetailView clusterId="c1" name="team-a" onOpenResource={() => undefined} />)

    for (const name of ['Overview', 'Quotas', 'Limits', 'Policies', 'YAML', 'Events']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })
})
