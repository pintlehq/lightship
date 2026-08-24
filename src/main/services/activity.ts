import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import type { ActivityHistory, ActivityInput, ActivityRecord } from '../../shared/ipc-types'
import { ActivityHistorySchema } from '../../shared/ipc-types'
import { parseOrFallback } from '../../shared/validate'
import { listClusters } from './cluster-store'

// Global Activity history of mutating actions, persisted alongside clusters.json /
// ui-state.json under userData/lightship. Non-sensitive — plain JSON, no safeStorage.
const baseDir = (): string => join(app.getPath('userData'), 'lightship')
const file = (): string => join(baseDir(), 'activity.json')

const EMPTY: ActivityHistory = { records: [] }

// Records accumulate forever; keep only the most recent N (FIFO, drop oldest).
const MAX_ACTIVITY = 500

// Reads-modify-writes are serialized through this promise chain so overlapping
// appends (parallel tabs, quick succession) can't clobber each other's writes.
let writeChain: Promise<void> = Promise.resolve()

/** Records as stored on disk: oldest-first (append order). */
async function readRaw(): Promise<ActivityRecord[]> {
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(file(), 'utf8'))
  } catch {
    return [] // missing / unreadable file
  }
  // A corrupt activity.json must never crash startup — fall back to empty.
  return parseOrFallback(ActivityHistorySchema, raw, EMPTY, 'activity.json').records
}

async function writeRaw(records: ActivityRecord[]): Promise<void> {
  await fs.mkdir(baseDir(), { recursive: true })
  await fs.writeFile(file(), JSON.stringify({ records }, null, 2), 'utf8')
}

/** The Activity history, newest first (the order the view renders). */
export async function readActivity(): Promise<ActivityRecord[]> {
  return (await readRaw()).reverse()
}

/** Append one action; resolves the cluster name and stamps id/ts. */
export async function recordActivity(input: ActivityInput): Promise<ActivityRecord> {
  const clusterName =
    (await listClusters()).find((c) => c.id === input.clusterId)?.name ?? input.clusterId
  const rec: ActivityRecord = {
    ...input,
    id: `${Date.now()}-${randomUUID()}`,
    ts: Date.now(),
    clusterName
  }
  await (writeChain = writeChain.then(async () => {
    const records = (await readRaw()).concat(rec)
    if (records.length > MAX_ACTIVITY) records.splice(0, records.length - MAX_ACTIVITY)
    await writeRaw(records)
  }))
  return rec
}

/** Erase the whole history. */
export async function clearActivity(): Promise<void> {
  await (writeChain = writeChain.then(() => writeRaw([])))
}
