import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  promises as fs,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

// Route userData to a throwaway directory and make safeStorage a reversible,
// clearly non-plaintext transform so tests can inspect the persisted envelope.
const env = vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs')
  const os = require('node:os') as typeof import('node:os')
  const path = require('node:path') as typeof import('node:path')
  const MARK = 'ENC::'
  return {
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'lightship-cs-')),
    encAvailable: true,
    MARK
  }
})

vi.mock('electron', () => ({
  app: { getPath: () => env.dir },
  safeStorage: {
    isEncryptionAvailable: () => env.encAvailable,
    encryptString: (s: string) => Buffer.from(env.MARK + Buffer.from(s, 'utf8').toString('base64')),
    decryptString: (b: Buffer) =>
      Buffer.from(b.toString('utf8').slice(env.MARK.length), 'base64').toString('utf8')
  }
}))

// Imported after vi.mock so its top-level `from 'electron'` binds the stub.
import * as store from './cluster-store'

const SECRET = [
  'apiVersion: v1',
  'kind: Config',
  'clusters:',
  '- name: c',
  '  cluster:',
  '    server: https://api.example:6443',
  '    certificate-authority-data: BEGIN-CERTIFICATE-PLAINTEXT',
  'users:',
  '- name: u',
  '  user:',
  '    token: SUPER-SECRET-TOKEN'
].join('\n')

const lightshipDataDir = join(env.dir, 'lightship-data')
const configsDir = join(lightshipDataDir, 'configs')
const clustersJson = join(configsDir, 'clusters.json')
const legacyDir = join(env.dir, 'Clusters')
const previousConfigsDir = join(env.dir, 'configs')

beforeEach(() => {
  env.encAvailable = true
  rmSync(configsDir, { recursive: true, force: true })
  rmSync(lightshipDataDir, { recursive: true, force: true })
  rmSync(legacyDir, { recursive: true, force: true })
  rmSync(previousConfigsDir, { recursive: true, force: true })
})

afterEach(() => vi.restoreAllMocks())
afterAll(() => rmSync(env.dir, { recursive: true, force: true }))

describe('cluster-store', () => {
  it('round-trips through one versioned file with encrypted credentials', async () => {
    const meta = await store.saveCluster(
      { name: 'prod', context: 'prod-ctx', server: 'https://api.example:6443' },
      SECRET
    )

    // listClusters reflects the addition, metadata only.
    expect(await store.listClusters()).toContainEqual(meta)

    // The public list exposes metadata only.
    expect(meta).not.toHaveProperty('encryptedKubeconfig')

    // clusters.json holds the encrypted blob, never the kubeconfig plaintext.
    const metaFile = readFileSync(clustersJson, 'utf8')
    expect(metaFile).not.toContain('SUPER-SECRET-TOKEN')
    expect(metaFile).not.toContain('BEGIN-CERTIFICATE-PLAINTEXT')
    const persisted = JSON.parse(metaFile)
    expect(persisted.schemaVersion).toBe(1)
    expect(persisted.clusters).toHaveLength(1)
    expect(
      Buffer.from(persisted.clusters[0].encryptedKubeconfig, 'base64').toString('utf8')
    ).toMatch(/^ENC::/)

    // readKubeconfig decrypts back to the original.
    expect(await store.readKubeconfig(meta.id)).toBe(SECRET)

    // Removing the record removes its encrypted credential in the same commit.
    await store.removeCluster(meta.id)
    expect(await store.listClusters()).toHaveLength(0)
    expect(JSON.parse(readFileSync(clustersJson, 'utf8')).clusters).toEqual([])
  })

  it('renames the display name without touching the stored secret', async () => {
    const meta = await store.saveCluster(
      { name: 'old', context: 'ctx', server: 'https://x' },
      SECRET
    )
    const encryptedBefore = JSON.parse(readFileSync(clustersJson, 'utf8')).clusters[0]
      .encryptedKubeconfig
    await store.renameCluster(meta.id, 'new')

    const list = await store.listClusters()
    expect(list.find((c) => c.id === meta.id)?.name).toBe('new')
    expect(await store.readKubeconfig(meta.id)).toBe(SECRET)
    expect(JSON.parse(readFileSync(clustersJson, 'utf8')).clusters[0].encryptedKubeconfig).toBe(
      encryptedBefore
    )
  })

  it('reorders cluster metadata without touching stored secrets', async () => {
    const alpha = await store.saveCluster(
      { name: 'alpha', context: 'alpha', server: 'https://a' },
      SECRET
    )
    const beta = await store.saveCluster(
      { name: 'beta', context: 'beta', server: 'https://b' },
      SECRET
    )
    const gamma = await store.saveCluster(
      { name: 'gamma', context: 'gamma', server: 'https://c' },
      SECRET
    )

    const ordered = await store.reorderClusters([gamma.id, alpha.id, beta.id])

    expect(ordered.map((c) => c.id)).toEqual([gamma.id, alpha.id, beta.id])
    expect((await store.listClusters()).map((c) => c.id)).toEqual([gamma.id, alpha.id, beta.id])
    expect(await store.readKubeconfig(alpha.id)).toBe(SECRET)
    expect(await store.readKubeconfig(beta.id)).toBe(SECRET)
    expect(await store.readKubeconfig(gamma.id)).toBe(SECRET)
  })

  it('rejects incomplete, duplicate, and unknown cluster orders without changing storage', async () => {
    const alpha = await store.saveCluster(
      { name: 'alpha', context: 'alpha', server: 'https://a' },
      SECRET
    )
    const beta = await store.saveCluster(
      { name: 'beta', context: 'beta', server: 'https://b' },
      SECRET
    )
    const gamma = await store.saveCluster(
      { name: 'gamma', context: 'gamma', server: 'https://c' },
      SECRET
    )
    const original = [alpha.id, beta.id, gamma.id]

    await expect(store.reorderClusters([alpha.id, beta.id])).rejects.toThrow(/exactly once/)
    expect((await store.listClusters()).map((c) => c.id)).toEqual(original)

    await expect(store.reorderClusters([alpha.id, alpha.id, gamma.id])).rejects.toThrow(
      /exactly once/
    )
    expect((await store.listClusters()).map((c) => c.id)).toEqual(original)

    await expect(store.reorderClusters([alpha.id, beta.id, 'missing'])).rejects.toThrow(
      /exactly once/
    )
    expect((await store.listClusters()).map((c) => c.id)).toEqual(original)
  })

  it('refuses to persist credentials when OS secure storage is unavailable', async () => {
    env.encAvailable = false
    await expect(
      store.saveCluster({ name: 'x', context: 'ctx', server: 'https://x' }, SECRET)
    ).rejects.toThrow(/safeStorage/)
    expect(existsSync(clustersJson)).toBe(false)
  })

  it('returns an empty list when nothing has been saved', async () => {
    expect(await store.listClusters()).toEqual([])
  })

  it('serializes concurrent saves without losing clusters', async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_value, index) =>
        store.saveCluster(
          { name: `cluster-${index}`, context: `context-${index}`, server: `https://${index}` },
          `${SECRET}\n# ${index}`
        )
      )
    )

    const clusters = await store.listClusters()
    expect(clusters).toHaveLength(25)
    expect(new Set(clusters.map((cluster) => cluster.name)).size).toBe(25)
  })

  it('keeps the prior commit after a rename failure and accepts the next write', async () => {
    const first = await store.saveCluster(
      { name: 'first', context: 'first', server: 'https://first' },
      SECRET
    )
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('injected rename failure'))

    await expect(
      store.saveCluster({ name: 'failed', context: 'failed', server: 'https://failed' }, SECRET)
    ).rejects.toThrow(/injected rename failure/)
    expect(await store.listClusters()).toEqual([first])

    const second = await store.saveCluster(
      { name: 'second', context: 'second', server: 'https://second' },
      SECRET
    )
    expect(await store.listClusters()).toEqual([first, second])
  })

  it('rejects malformed and unsupported stores without overwriting them', async () => {
    mkdirSync(configsDir, { recursive: true })
    const invalidStores = [
      '{ invalid',
      JSON.stringify({ schemaVersion: 2, clusters: [] }),
      JSON.stringify({
        schemaVersion: 1,
        clusters: [
          {
            id: 'id',
            name: 'name',
            context: 'context',
            server: 'https://server',
            encryptedKubeconfig: 'not base64!'
          }
        ]
      })
    ]
    for (const contents of invalidStores) {
      writeFileSync(clustersJson, contents, 'utf8')
      await expect(store.listClusters()).rejects.toThrow()
      await expect(
        store.saveCluster({ name: 'new', context: 'new', server: 'https://new' }, SECRET)
      ).rejects.toThrow()
      expect(readFileSync(clustersJson, 'utf8')).toBe(contents)
    }
  })

  it('uses private POSIX permissions for the new store', async () => {
    if (process.platform === 'win32') return
    await store.saveCluster(
      { name: 'private', context: 'private', server: 'https://private' },
      SECRET
    )

    expect(statSync(lightshipDataDir).mode & 0o777).toBe(0o700)
    expect(statSync(configsDir).mode & 0o777).toBe(0o700)
    expect(statSync(clustersJson).mode & 0o777).toBe(0o600)
  })

  it('ignores and preserves both previous cluster-store locations', async () => {
    mkdirSync(legacyDir, { recursive: true })
    const legacyFile = join(legacyDir, 'clusters.json')
    writeFileSync(legacyFile, JSON.stringify([{ id: 'legacy', name: 'legacy' }]), 'utf8')
    mkdirSync(previousConfigsDir, { recursive: true })
    const previousFile = join(previousConfigsDir, 'clusters.json')
    writeFileSync(previousFile, JSON.stringify({ schemaVersion: 1, clusters: [] }), 'utf8')

    expect(await store.listClusters()).toEqual([])
    await store.saveCluster({ name: 'fresh', context: 'fresh', server: 'https://fresh' }, SECRET)
    expect(readFileSync(legacyFile, 'utf8')).toContain('legacy')
    expect(JSON.parse(readFileSync(previousFile, 'utf8')).clusters).toEqual([])
  })

  it('rejects kubeconfig reads for unknown clusters', async () => {
    await expect(store.readKubeconfig('missing')).rejects.toThrow(/Unknown cluster/)
  })
})
