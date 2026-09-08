import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import type { ClusterMeta } from '../../shared/ipc-types'
import { ClusterMetaSchema } from '../../shared/ipc-types'
import { parseOrThrow } from '../../shared/validate'
import { readFileIfPresent, SerialQueue, storagePaths, writeJsonAtomically } from './storage'

const PersistedClusterSchema = ClusterMetaSchema.extend({
  encryptedKubeconfig: z.base64().min(1)
})
const ClusterStoreSchema = z.object({
  schemaVersion: z.literal(1),
  clusters: z.array(PersistedClusterSchema)
})

type PersistedCluster = z.infer<typeof PersistedClusterSchema>
type ClusterStore = z.infer<typeof ClusterStoreSchema>

const EMPTY_STORE: ClusterStore = { schemaVersion: 1, clusters: [] }
const writes = new SerialQueue()

function publicMeta(cluster: PersistedCluster): ClusterMeta {
  return {
    id: cluster.id,
    name: cluster.name,
    context: cluster.context,
    server: cluster.server,
    env: cluster.env
  }
}

async function readStore(): Promise<ClusterStore> {
  const raw = await readFileIfPresent(storagePaths().clusters)
  if (raw === undefined) return EMPTY_STORE

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error('clusters.json contains invalid JSON.', { cause: error })
  }
  return parseOrThrow(ClusterStoreSchema, parsed, 'clusters.json')
}

async function writeStore(store: ClusterStore): Promise<void> {
  const validated = parseOrThrow(ClusterStoreSchema, store, 'clusters.json')
  await writeJsonAtomically(storagePaths().clusters, validated)
}

export async function listClusters(): Promise<ClusterMeta[]> {
  await writes.wait()
  return (await readStore()).clusters.map(publicMeta)
}

export async function saveCluster(
  meta: Omit<ClusterMeta, 'id'> & { id?: string },
  kubeconfigYaml: string
): Promise<ClusterMeta> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS secure storage (safeStorage) is unavailable; refusing to persist credentials.'
    )
  }
  const id = meta.id ?? randomUUID()
  const full: PersistedCluster = {
    id,
    name: meta.name,
    context: meta.context,
    server: meta.server,
    env: meta.env,
    encryptedKubeconfig: safeStorage.encryptString(kubeconfigYaml).toString('base64')
  }
  await writes.run(async () => {
    const store = await readStore()
    await writeStore({
      schemaVersion: 1,
      clusters: [...store.clusters.filter((cluster) => cluster.id !== id), full]
    })
  })
  return publicMeta(full)
}

/** Rename a cluster's display name only (kubeconfig/context untouched). */
export async function renameCluster(id: string, name: string): Promise<void> {
  await writes.run(async () => {
    const store = await readStore()
    await writeStore({
      schemaVersion: 1,
      clusters: store.clusters.map((cluster) =>
        cluster.id === id ? { ...cluster, name } : cluster
      )
    })
  })
}

export async function reorderClusters(ids: string[]): Promise<ClusterMeta[]> {
  return writes.run(async () => {
    const store = await readStore()
    const byId = new Map(store.clusters.map((cluster) => [cluster.id, cluster]))
    const uniqueIds = new Set(ids)

    if (
      ids.length !== store.clusters.length ||
      uniqueIds.size !== ids.length ||
      ids.some((id) => !byId.has(id))
    ) {
      throw new Error('Cluster order must include each saved cluster exactly once.')
    }

    const ordered = ids.map((id) => byId.get(id)!)
    await writeStore({ schemaVersion: 1, clusters: ordered })
    return ordered.map(publicMeta)
  })
}

export async function readKubeconfig(id: string): Promise<string> {
  await writes.wait()
  const cluster = (await readStore()).clusters.find((candidate) => candidate.id === id)
  if (!cluster) throw new Error(`Unknown cluster: ${id}`)
  return safeStorage.decryptString(Buffer.from(cluster.encryptedKubeconfig, 'base64'))
}

export async function removeCluster(id: string): Promise<void> {
  await writes.run(async () => {
    const store = await readStore()
    await writeStore({
      schemaVersion: 1,
      clusters: store.clusters.filter((cluster) => cluster.id !== id)
    })
  })
}
