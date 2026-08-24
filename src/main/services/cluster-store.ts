import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { ClusterMeta } from '../../shared/ipc-types'
import { ClusterMetaArraySchema } from '../../shared/ipc-types'
import { parseOrFallback } from '../../shared/validate'

// Persisted under userData/lightship:
//   clusters.json                  — plaintext metadata (no secrets)
//   clusters/<id>.kubeconfig.enc   — safeStorage-encrypted per-cluster kubeconfig
const baseDir = () => join(app.getPath('userData'), 'lightship')
const clustersFile = () => join(baseDir(), 'clusters.json')
const secretsDir = () => join(baseDir(), 'clusters')
const secretFile = (id: string) => join(secretsDir(), `${id}.kubeconfig.enc`)

export async function listClusters(): Promise<ClusterMeta[]> {
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(clustersFile(), 'utf8'))
  } catch {
    return [] // missing / unreadable file
  }
  // A corrupt clusters.json must not crash the app — fall back to empty.
  return parseOrFallback(ClusterMetaArraySchema, raw, [], 'clusters.json')
}

async function writeClusters(list: ClusterMeta[]): Promise<void> {
  await fs.mkdir(baseDir(), { recursive: true })
  await fs.writeFile(clustersFile(), JSON.stringify(list, null, 2), 'utf8')
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
  const full: ClusterMeta = {
    id,
    name: meta.name,
    context: meta.context,
    server: meta.server,
    env: meta.env
  }
  await fs.mkdir(secretsDir(), { recursive: true })
  await fs.writeFile(secretFile(id), safeStorage.encryptString(kubeconfigYaml))
  const list = await listClusters()
  await writeClusters([...list.filter((c) => c.id !== id), full])
  return full
}

/** Rename a cluster's display name only (kubeconfig/context untouched). */
export async function renameCluster(id: string, name: string): Promise<void> {
  const list = await listClusters()
  await writeClusters(list.map((c) => (c.id === id ? { ...c, name } : c)))
}

export async function reorderClusters(ids: string[]): Promise<ClusterMeta[]> {
  const list = await listClusters()
  const byId = new Map(list.map((c) => [c.id, c]))
  const uniqueIds = new Set(ids)

  if (
    ids.length !== list.length ||
    uniqueIds.size !== ids.length ||
    ids.some((id) => !byId.has(id))
  ) {
    throw new Error('Cluster order must include each saved cluster exactly once.')
  }

  const ordered = ids.map((id) => byId.get(id)!)
  await writeClusters(ordered)
  return ordered
}

export async function readKubeconfig(id: string): Promise<string> {
  const buf = await fs.readFile(secretFile(id))
  return safeStorage.decryptString(buf)
}

export async function removeCluster(id: string): Promise<void> {
  const list = await listClusters()
  await writeClusters(list.filter((c) => c.id !== id))
  try {
    await fs.unlink(secretFile(id))
  } catch {
    /* already gone */
  }
}
