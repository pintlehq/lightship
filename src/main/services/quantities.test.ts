import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ageOf,
  cpuToCores,
  cpuToMillicores,
  memoryToBytes,
  memoryToRoundedBytes
} from './quantities'

describe('cpuToCores (cores)', () => {
  it('retains the distinct rounding conventions of core and millicore callers', () => {
    expect(cpuToCores('1.9m')).toBeCloseTo(0.0019)
    expect(cpuToMillicores('1.9m')).toBe(1)
    expect(cpuToMillicores('0.0006')).toBe(1)
    expect(memoryToBytes('1.25')).toBe(1.25)
    expect(memoryToRoundedBytes('1.25')).toBe(1)
  })
  it('converts suffixes and bare values to cores', () => {
    expect(cpuToCores(undefined)).toBe(0)
    expect(cpuToCores('')).toBe(0)
    expect(cpuToCores('250m')).toBeCloseTo(0.25)
    expect(cpuToCores('500n')).toBeCloseTo(5e-7, 9)
    expect(cpuToCores('1500u')).toBeCloseTo(0.0015, 6)
    expect(cpuToCores('2')).toBe(2)
  })
})

describe('memoryToBytes (bytes)', () => {
  it('handles binary and decimal units plus passthrough', () => {
    expect(memoryToBytes(undefined)).toBe(0)
    expect(memoryToBytes('1Gi')).toBe(1024 ** 3)
    expect(memoryToBytes('512Mi')).toBe(512 * 1024 ** 2)
    expect(memoryToBytes('2Ki')).toBe(2048)
    expect(memoryToBytes('1000M')).toBe(1e9)
    expect(memoryToBytes('2048')).toBe(2048) // bare number, no unit
    expect(memoryToBytes('5x')).toBe(5) // unknown unit → factor 1
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

describe('cpuToMillicores (millicores)', () => {
  it('normalizes quantities to millicores', () => {
    expect(cpuToMillicores('500m')).toBe(500)
    expect(cpuToMillicores('250m')).toBe(250)
    expect(cpuToMillicores('1')).toBe(1000)
    expect(cpuToMillicores('0.5')).toBe(500)
    expect(cpuToMillicores('')).toBe(0)
    expect(cpuToMillicores('garbage')).toBe(0)
  })
})

describe('memoryToRoundedBytes (bytes, rounded)', () => {
  it('normalizes quantities to bytes', () => {
    expect(memoryToRoundedBytes('1Gi')).toBe(1024 ** 3)
    expect(memoryToRoundedBytes('512Mi')).toBe(512 * 1024 ** 2)
    expect(memoryToRoundedBytes('1.5Gi')).toBe(Math.round(1.5 * 1024 ** 3))
    expect(memoryToRoundedBytes(' 256Mi ')).toBe(256 * 1024 ** 2)
    expect(memoryToRoundedBytes('nope')).toBe(0)
  })
})
