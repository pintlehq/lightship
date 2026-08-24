import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// cluster-store talks to Electron's `app` (paths) and `safeStorage` (keychain
// encryption). Stub both: route userData to a throwaway temp dir and make
// `safeStorage` a reversible, clearly-non-plaintext transform so we can assert
// the on-disk security invariant (M0: clusters.json holds no token/cert; the
// secret blob is encrypted; removing a cluster deletes its secret).
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

const lightshipDir = join(env.dir, 'lightship')
const clustersJson = join(lightshipDir, 'clusters.json')
const secretPath = (id: string) => join(lightshipDir, 'clusters', `${id}.kubeconfig.enc`)

beforeEach(() => {
  env.encAvailable = true
  rmSync(lightshipDir, { recursive: true, force: true })
})

afterAll(() => rmSync(env.dir, { recursive: true, force: true }))

describe('cluster-store', () => {
  it('round-trips save → list → read → remove with encrypted on-disk secrets', async () => {
    const meta = await store.saveCluster(
      { name: 'prod', context: 'prod-ctx', server: 'https://api.example:6443' },
      SECRET
    )

    // listClusters reflects the addition, metadata only.
    expect(await store.listClusters()).toContainEqual(meta)

    // clusters.json never holds the token or cert plaintext.
    const metaFile = readFileSync(clustersJson, 'utf8')
    expect(metaFile).not.toContain('SUPER-SECRET-TOKEN')
    expect(metaFile).not.toContain('BEGIN-CERTIFICATE-PLAINTEXT')

    // The secret blob is encrypted (not readable kubeconfig YAML).
    const blob = readFileSync(secretPath(meta.id), 'utf8')
    expect(blob.startsWith(env.MARK)).toBe(true)
    expect(blob).not.toContain('SUPER-SECRET-TOKEN')
    expect(blob).not.toContain('apiVersion: v1')

    // readKubeconfig decrypts back to the original.
    expect(await store.readKubeconfig(meta.id)).toBe(SECRET)

    // removeCluster drops metadata AND unlinks the encrypted secret.
    await store.removeCluster(meta.id)
    expect(await store.listClusters()).toHaveLength(0)
    expect(existsSync(secretPath(meta.id))).toBe(false)
  })

  it('renames the display name without touching the stored secret', async () => {
    const meta = await store.saveCluster(
      { name: 'old', context: 'ctx', server: 'https://x' },
      SECRET
    )
    await store.renameCluster(meta.id, 'new')

    const list = await store.listClusters()
    expect(list.find((c) => c.id === meta.id)?.name).toBe('new')
    expect(await store.readKubeconfig(meta.id)).toBe(SECRET)
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
    expect(existsSync(secretPath(alpha.id))).toBe(true)
    expect(existsSync(secretPath(beta.id))).toBe(true)
    expect(existsSync(secretPath(gamma.id))).toBe(true)
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
})
