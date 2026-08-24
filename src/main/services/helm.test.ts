import { describe, expect, it, vi } from 'vitest'
import { gzipSync } from 'node:zlib'

// helm.ts imports ./k8s (→ electron) at module load; only decodeRelease is pure,
// so stub ./k8s to keep the test hermetic.
vi.mock('./k8s', () => ({
  ageOf: () => '',
  kcForCluster: async () => ({}),
  loadK8s: async () => ({})
}))

import { decodeRelease } from './helm'

const sample = {
  name: 'app',
  namespace: 'default',
  version: 3,
  info: { status: 'deployed', last_deployed: '2024-01-01T00:00:00Z' },
  chart: { metadata: { name: 'nginx', version: '1.2.3', appVersion: '1.25' } }
}
const gz = (): Buffer => gzipSync(Buffer.from(JSON.stringify(sample)))

describe('decodeRelease', () => {
  it('decodes the standard double-base64 + gzip Helm payload', () => {
    const helmLayer = gz().toString('base64') // helm stores base64(gzip(json))
    const k8sLayer = Buffer.from(helmLayer).toString('base64') // k8s base64s the secret value
    expect(decodeRelease(k8sLayer)).toMatchObject({
      name: 'app',
      version: 3,
      chart: { metadata: { name: 'nginx', version: '1.2.3' } }
    })
  })

  it('falls back to a single-base64 (already-gzip) payload', () => {
    expect(decodeRelease(gz().toString('base64'))).toMatchObject({ name: 'app', version: 3 })
  })
})
