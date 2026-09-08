import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import type { ActivityInput, ActivityRecord } from '../../shared/ipc-types'
import { ActivityRecordArraySchema } from '../../shared/ipc-types'
import { parseOrFallback } from '../../shared/validate'
import { listClusters } from './cluster-store'
import { readFileIfPresent, SerialQueue, storagePaths, writeJsonAtomically } from './storage'

const PersistedActivitySchema = z.object({
  schemaVersion: z.literal(1),
  records: ActivityRecordArraySchema
})
const EMPTY = { schemaVersion: 1 as const, records: [] as ActivityRecord[] }

// Records accumulate forever; keep only the most recent N (FIFO, drop oldest).
const MAX_ACTIVITY = 500

const writes = new SerialQueue()

/** Records as stored on disk: oldest-first (append order). */
async function readRaw(): Promise<ActivityRecord[]> {
  const text = await readFileIfPresent(storagePaths().activity)
  if (text === undefined) return []

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  return parseOrFallback(PersistedActivitySchema, raw, EMPTY, 'activity.json').records
}

async function writeRaw(records: ActivityRecord[]): Promise<void> {
  await writeJsonAtomically(storagePaths().activity, { schemaVersion: 1, records })
}

/** The Activity history, newest first (the order the view renders). */
export async function readActivity(): Promise<ActivityRecord[]> {
  await writes.wait()
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
  await writes.run(async () => {
    const records = (await readRaw()).concat(rec)
    if (records.length > MAX_ACTIVITY) records.splice(0, records.length - MAX_ACTIVITY)
    await writeRaw(records)
  })
  return rec
}

/** Erase the whole history. */
export async function clearActivity(): Promise<void> {
  await writes.run(() => writeRaw([]))
}
