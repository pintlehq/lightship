import { describe, expect, it, vi } from 'vitest'
import { buildOverviewBundle } from './overview'
vi.mock('./k8s-client', () => ({}))

describe('buildOverviewBundle', () => {
  it('composes overview and events into one IPC DTO', async () => {
    const overview = {
      nodes: 2,
      nodesReady: 2,
      pods: 12,
      podsCapacity: 20,
      cpuPct: 50,
      memPct: 60,
      cpuReqPct: 25,
      cpuRequest: '1.0 / 4.0',
      memReqPct: 30,
      memRequest: '3.0Gi / 10.0Gi',
      namespaces: 3
    }
    const events = [
      { type: 'Normal', reason: 'Started', object: 'Pod/api', message: 'Started', age: '1m' }
    ]

    await expect(
      buildOverviewBundle(
        () => Promise.resolve(overview),
        () => Promise.resolve(events)
      )
    ).resolves.toEqual({
      overview,
      events
    })
  })
})
