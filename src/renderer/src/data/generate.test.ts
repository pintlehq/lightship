import { describe, it, expect } from 'vitest'
import { generatePods, generateNodes } from './generate'

const POD_STATUSES = new Set([
  'Running',
  'Pending',
  'CrashLoopBackOff',
  'Completed',
  'Terminating',
  'Error'
])

describe('generatePods', () => {
  it('returns the requested number of rows', () => {
    expect(generatePods(0)).toHaveLength(0)
    expect(generatePods(50)).toHaveLength(50)
  })

  it('is deterministic for a given count (seeded PRNG)', () => {
    expect(generatePods(30)).toEqual(generatePods(30))
  })

  it('only produces known statuses', () => {
    for (const pod of generatePods(200)) {
      expect(POD_STATUSES.has(pod.status)).toBe(true)
    }
  })

  it('CrashLoopBackOff pods have restarted at least 3 times', () => {
    for (const pod of generatePods(300)) {
      if (pod.status === 'CrashLoopBackOff') expect(pod.restarts).toBeGreaterThanOrEqual(3)
    }
  })

  it('Pending pods are unscheduled (node and ip are em-dash)', () => {
    for (const pod of generatePods(300)) {
      if (pod.status === 'Pending') {
        expect(pod.node).toBe('—')
        expect(pod.ip).toBe('—')
      }
    }
  })
})

describe('generateNodes', () => {
  it('returns the requested number of rows', () => {
    expect(generateNodes(12)).toHaveLength(12)
  })

  it('is deterministic for a given count', () => {
    expect(generateNodes(12)).toEqual(generateNodes(12))
  })

  it('reports CPU/mem percentages within 0–100 and a known status', () => {
    for (const node of generateNodes(200)) {
      expect(node.cpuPct).toBeGreaterThanOrEqual(0)
      expect(node.cpuPct).toBeLessThanOrEqual(100)
      expect(node.memPct).toBeGreaterThanOrEqual(0)
      expect(node.memPct).toBeLessThanOrEqual(100)
      expect(['Ready', 'NotReady']).toContain(node.status)
    }
  })
})
