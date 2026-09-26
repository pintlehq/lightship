import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  read: vi.fn(),
  replace: vi.fn(),
  kcForCluster: vi.fn(async () => ({})),
  makeApiClient: vi.fn()
}))

vi.mock('./k8s', () => ({
  kcForCluster: mocks.kcForCluster,
  loadK8s: async () => ({ KubernetesObjectApi: { makeApiClient: mocks.makeApiClient } })
}))

import { ConfigDataSaveResultSchema, ConfigDataUpdateSchema } from '../../shared/ipc-types'
import { applyConfigData, getConfigData } from './resources'

const configMap = { kind: 'configmaps', namespace: 'web', name: 'settings' }
const secret = { kind: 'secrets', namespace: 'web', name: 'credentials' }
const copy = <T>(value: T): T => structuredClone(value)

beforeEach(() => {
  mocks.current = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: 'settings', namespace: 'web', resourceVersion: '10', labels: { app: 'api' } },
    data: { A: 'one', B: 'two' },
    binaryData: { BIN: 'AAE=' }
  }
  mocks.kcForCluster.mockClear()
  mocks.makeApiClient.mockReset().mockReturnValue({ read: mocks.read, replace: mocks.replace })
  mocks.read.mockReset().mockImplementation(async () => copy(mocks.current))
  mocks.replace.mockReset().mockImplementation(async (object: Record<string, unknown>) => {
    const metadata = object.metadata as Record<string, unknown>
    const currentMetadata = mocks.current.metadata as Record<string, unknown>
    if (metadata.resourceVersion !== currentMetadata.resourceVersion) throw { statusCode: 409 }
    mocks.current = {
      ...copy(object),
      metadata: { ...metadata, resourceVersion: '11' }
    }
    return copy(mocks.current)
  })
})

describe('ConfigMap and Secret concurrency', () => {
  it('returns the original version with editable data and binary key names', async () => {
    expect(await getConfigData('cluster-a', configMap)).toEqual({
      secret: false,
      data: { A: 'one', B: 'two' },
      binaryKeys: ['BIN'],
      resourceVersion: '10'
    })
  })

  it('lets one editor save and returns a conflict to another without replacement', async () => {
    const first = await getConfigData('cluster-a', configMap)
    const second = await getConfigData('cluster-a', configMap)
    const saved = await applyConfigData('cluster-a', configMap, {
      resourceVersion: first.resourceVersion,
      data: { A: 'updated', B: 'two' }
    })
    expect(saved.status).toBe('saved')
    expect(saved.current.resourceVersion).toBe('11')
    const conflict = await applyConfigData('cluster-a', configMap, {
      resourceVersion: second.resourceVersion,
      data: { A: 'other', B: 'two' }
    })
    expect(conflict).toEqual({ status: 'conflict', current: saved.current })
    expect(mocks.replace).toHaveBeenCalledOnce()
  })

  it('exposes externally added and deleted keys in the conflict snapshot', async () => {
    mocks.current = {
      ...mocks.current,
      metadata: { name: 'settings', namespace: 'web', resourceVersion: '11' },
      data: { B: 'two', C: 'new' }
    }
    const result = await applyConfigData('cluster-a', configMap, {
      resourceVersion: '10',
      data: { A: 'edited', B: 'two' }
    })
    expect(result).toMatchObject({
      status: 'conflict',
      current: { data: { B: 'two', C: 'new' }, resourceVersion: '11' }
    })
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('treats a version change between read and replace as a conflict', async () => {
    mocks.replace.mockImplementationOnce(async () => {
      mocks.current = {
        ...mocks.current,
        metadata: { name: 'settings', namespace: 'web', resourceVersion: '11' },
        data: { A: 'remote', B: 'two' }
      }
      throw { response: { statusCode: 409 } }
    })
    const result = await applyConfigData('cluster-a', configMap, {
      resourceVersion: '10',
      data: { A: 'mine', B: 'two' }
    })
    expect(result).toMatchObject({
      status: 'conflict',
      current: { resourceVersion: '11', data: { A: 'remote', B: 'two' } }
    })
    expect(mocks.read).toHaveBeenCalledTimes(2)
  })

  it('does not replace unchanged data or lose binary and metadata fields', async () => {
    const unchanged = await applyConfigData('cluster-a', configMap, {
      resourceVersion: '10',
      data: { A: 'one', B: 'two' }
    })
    expect(unchanged.status).toBe('unchanged')
    expect(mocks.replace).not.toHaveBeenCalled()

    await applyConfigData('cluster-a', configMap, {
      resourceVersion: '10',
      data: { A: 'edited' }
    })
    expect(mocks.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ resourceVersion: '10', labels: { app: 'api' } }),
        binaryData: { BIN: 'AAE=' },
        data: { A: 'edited' }
      })
    )
  })

  it('preserves binary Secret entries and keeps their bytes out of the editable data', async () => {
    mocks.current = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'credentials', namespace: 'web', resourceVersion: '10' },
      data: { TOKEN: Buffer.from('old').toString('base64'), BIN: 'AAE=' },
      stringData: { TRANSIENT: 'unused' },
      type: 'Opaque'
    }
    expect(await getConfigData('cluster-a', secret)).toEqual({
      secret: true,
      data: { TOKEN: 'old' },
      binaryKeys: ['BIN'],
      resourceVersion: '10'
    })
    const result = await applyConfigData('cluster-a', secret, {
      resourceVersion: '10',
      data: { TOKEN: 'new' }
    })
    expect(result).toMatchObject({ status: 'saved', current: { data: { TOKEN: 'new' } } })
    expect(mocks.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { TOKEN: Buffer.from('new').toString('base64'), BIN: 'AAE=' },
        type: 'Opaque'
      })
    )
    expect(mocks.replace.mock.calls[0][0]).not.toHaveProperty('stringData')
  })

  it('rejects missing versions and binary collisions before replacement', async () => {
    await expect(
      applyConfigData('cluster-a', configMap, { resourceVersion: '', data: { A: 'new' } })
    ).rejects.toThrow(/Original resource version/)
    expect(mocks.kcForCluster).not.toHaveBeenCalled()
    await expect(
      applyConfigData('cluster-a', configMap, { resourceVersion: '10', data: { BIN: 'bad' } })
    ).rejects.toThrow(/binary entry/)
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('does not leak Secret values from a failed Kubernetes request', async () => {
    mocks.current = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'credentials', namespace: 'web', resourceVersion: '10' },
      data: { TOKEN: Buffer.from('sensitive').toString('base64') }
    }
    mocks.replace.mockRejectedValueOnce(new Error('server echoed sensitive'))
    await expect(
      applyConfigData('cluster-a', secret, { resourceVersion: '10', data: { TOKEN: 'new' } })
    ).rejects.toThrow('Secret data save failed')
  })

  it('validates the IPC input and output shapes', () => {
    expect(() => ConfigDataUpdateSchema.parse({ data: {} })).toThrow()
    expect(() => ConfigDataUpdateSchema.parse({ resourceVersion: '', data: {} })).toThrow()
    expect(() =>
      ConfigDataSaveResultSchema.parse({
        status: 'conflict',
        current: { secret: false, data: {}, binaryKeys: [] }
      })
    ).toThrow()
  })
})
