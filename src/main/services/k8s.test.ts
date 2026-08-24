import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// k8s.ts imports cluster-store, which imports electron at module load. These
// tests only exercise pure helpers, so a minimal electron stub is enough to let
// the module import under Node. (@kubernetes/client-node is dynamically imported
// inside the API calls, so it is never loaded here.)
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/lightship-test' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8')
  }
}))

import { ageOf, buildOverviewBundle, parseCpu, parseMem } from './k8s'

describe('parseCpu (cores)', () => {
  it('converts suffixes and bare values to cores', () => {
    expect(parseCpu(undefined)).toBe(0)
    expect(parseCpu('')).toBe(0)
    expect(parseCpu('250m')).toBeCloseTo(0.25)
    expect(parseCpu('500n')).toBeCloseTo(5e-7, 9)
    expect(parseCpu('1500u')).toBeCloseTo(0.0015, 6)
    expect(parseCpu('2')).toBe(2)
  })
})

describe('parseMem (bytes)', () => {
  it('handles binary and decimal units plus passthrough', () => {
    expect(parseMem(undefined)).toBe(0)
    expect(parseMem('1Gi')).toBe(1024 ** 3)
    expect(parseMem('512Mi')).toBe(512 * 1024 ** 2)
    expect(parseMem('2Ki')).toBe(2048)
    expect(parseMem('1000M')).toBe(1e9)
    expect(parseMem('2048')).toBe(2048) // bare number, no unit
    expect(parseMem('5x')).toBe(5) // unknown unit → factor 1
  })
})

describe('ageOf', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-07T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  const ago = (seconds: number) => new Date(Date.now() - seconds * 1000)

  it('returns empty string for missing input', () => {
    expect(ageOf(undefined)).toBe('')
  })

  it('clamps future timestamps to 0s', () => {
    expect(ageOf(new Date(Date.now() + 60_000))).toBe('0s')
  })

  it('picks the largest whole unit', () => {
    expect(ageOf(ago(45))).toBe('45s')
    expect(ageOf(ago(90))).toBe('1m')
    expect(ageOf(ago(3700))).toBe('1h')
    expect(ageOf(ago(90_000))).toBe('1d')
  })

  it('accepts ISO strings as well as Date objects', () => {
    expect(ageOf(ago(120).toISOString())).toBe('2m')
  })
})

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
