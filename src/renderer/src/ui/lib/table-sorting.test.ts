import { describe, expect, it } from 'vitest'
import {
  byteValue,
  compareSortValues,
  cpuValue,
  durationValue,
  readinessValue
} from './table-sorting'

describe('table sorting values', () => {
  it('compares natural text without case sensitivity and numeric counts numerically', () => {
    expect(compareSortValues('service2', 'Service10')).toBeLessThan(0)
    expect(compareSortValues('v1.9', 'v1.10')).toBeLessThan(0)
    expect(compareSortValues('API', 'api')).toBe(0)
    expect(compareSortValues('2', '10')).toBeLessThan(0)
    expect(compareSortValues('0.25', '0.5')).toBeLessThan(0)
    expect(compareSortValues(2, 10)).toBeLessThan(0)
  })

  it.each(['', '—', '-', '<unknown>', 'N/A', undefined, null, Number.NaN])(
    'keeps unavailable value %s last after ascending and descending reversal',
    (missing) => {
      expect(compareSortValues(missing, 0)).toBeGreaterThan(0)
      expect(-compareSortValues(missing, 0, true)).toBeGreaterThan(0)
      expect(compareSortValues(missing, undefined)).toBe(0)
    }
  )

  it('converts durations across units and combined printer-column ages', () => {
    expect(durationValue('2h')).toBe(7200)
    expect(durationValue('120m')).toBe(7200)
    expect(durationValue('1d2h3m4s')).toBe(93784)
    expect(durationValue('0s')).toBe(0)
    expect(durationValue('1w')).toBe(604800)
    expect(durationValue('1y')).toBe(31536000)
    expect(durationValue('—')).toBeUndefined()
    expect(durationValue('3invalid')).toBeUndefined()
  })

  it('converts CPU quantities and binary/decimal byte quantities', () => {
    expect(cpuValue('250m')).toBe(0.25)
    expect(cpuValue('2')).toBe(2)
    expect(cpuValue('1000u')).toBe(0.001)
    expect(cpuValue('1000000n')).toBe(0.001)
    expect(cpuValue('—')).toBeUndefined()
    expect(byteValue('512Mi')).toBe(512 * 1024 ** 2)
    expect(byteValue('1.5GiB')).toBe(1.5 * 1024 ** 3)
    expect(byteValue('2G')).toBe(2e9)
    expect(byteValue('2GB')).toBe(2e9)
    expect(byteValue('32B')).toBe(32)
    expect(byteValue('0')).toBe(0)
    expect(byteValue('—')).toBeUndefined()
    expect(compareSortValues(byteValue('512Mi'), byteValue('1Gi'))).toBeLessThan(0)
  })

  it('compares readiness by ready count first and total count second', () => {
    expect(readinessValue('2/10')).toEqual([2, 10])
    expect(readinessValue('—')).toBeUndefined()
    expect(compareSortValues(readinessValue('2/10'), readinessValue('10/10'))).toBeLessThan(0)
    expect(compareSortValues(readinessValue('2/3'), readinessValue('2/10'))).toBeLessThan(0)
    expect(compareSortValues([2, 3], [2, 3])).toBe(0)
  })
})
