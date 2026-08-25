import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ActivityInput } from '../../shared/ipc-types'

// activity persists a JSON log under userData/Clusters. Route Electron's
// `app.getPath` to a throwaway temp dir so the service writes to disk in tests.
const env = vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs')
  const os = require('node:os') as typeof import('node:os')
  const path = require('node:path') as typeof import('node:path')
  return { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'lightship-act-')) }
})

vi.mock('electron', () => ({ app: { getPath: () => env.dir } }))

// Imported after vi.mock so its (transitive) `from 'electron'` binds the stub.
import * as activity from './activity'

const clustersDir = join(env.dir, 'Clusters')
const activityFile = join(clustersDir, 'activity.json')

const input = (over: Partial<ActivityInput> = {}): ActivityInput => ({
  clusterId: 'c1',
  action: 'delete',
  kind: 'pods',
  count: 1,
  outcome: 'success',
  ...over
})

beforeEach(() => {
  rmSync(clustersDir, { recursive: true, force: true })
})

afterAll(() => rmSync(env.dir, { recursive: true, force: true }))

describe('activity', () => {
  it('records and reads back, stamping id/ts and resolving clusterName', async () => {
    const rec = await activity.recordActivity(input({ name: 'api' }))
    expect(rec.id).toBeTruthy()
    expect(rec.ts).toBeGreaterThan(0)
    expect(rec.clusterName).toBe('c1') // no clusters.json → falls back to the id

    const all = await activity.readActivity()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ clusterId: 'c1', action: 'delete', name: 'api' })
  })

  it('returns newest first', async () => {
    await activity.recordActivity(input({ name: 'first' }))
    await activity.recordActivity(input({ name: 'second' }))
    const all = await activity.readActivity()
    expect(all.map((r) => r.name)).toEqual(['second', 'first'])
  })

  it('returns the empty default when no file exists', async () => {
    expect(await activity.readActivity()).toEqual([])
  })

  it('caps at 500 records, dropping the oldest', async () => {
    for (let i = 0; i < 510; i++) await activity.recordActivity(input({ name: `n${i}` }))
    const all = await activity.readActivity()
    expect(all).toHaveLength(500)
    expect(all[0].name).toBe('n509') // newest first
    expect(all.at(-1)?.name).toBe('n10') // oldest 10 (n0..n9) evicted
    expect(all.some((r) => r.name === 'n9')).toBe(false)
  })

  it('clears the history', async () => {
    await activity.recordActivity(input())
    await activity.clearActivity()
    expect(await activity.readActivity()).toEqual([])
  })

  it('falls back to empty on a corrupt or wrong-shape file', async () => {
    mkdirSync(clustersDir, { recursive: true })

    writeFileSync(activityFile, '{ not valid json', 'utf8')
    expect(await activity.readActivity()).toEqual([])

    writeFileSync(activityFile, JSON.stringify({ records: 'nope' }), 'utf8')
    expect(await activity.readActivity()).toEqual([])
  })

  it('serializes concurrent appends without losing writes', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_v, i) => activity.recordActivity(input({ name: `c${i}` })))
    )
    const all = await activity.readActivity()
    expect(all).toHaveLength(20)
    expect(new Set(all.map((r) => r.name)).size).toBe(20) // no clobbered/duplicate entries
  })
})
