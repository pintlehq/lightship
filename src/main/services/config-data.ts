import type { KubernetesObject } from '@kubernetes/client-node'

import type {
  ConfigData,
  ConfigDataSaveResult,
  ConfigDataUpdate,
  ResourceRef
} from '../../shared/ipc-types'
import { GVK } from './resource-gvk'
import { isVersionConflict, objectApi } from './resource-mutations'

type ConfigObject = KubernetesObject & {
  data?: Record<string, string>
  binaryData?: Record<string, string>
  stringData?: Record<string, string>
}

/** A base64 value is "text" if it round-trips as utf-8 with no control chars. */
function decodeTextSecret(b64: string): string | null {
  const buf = Buffer.from(b64, 'base64')
  const text = buf.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(buf)) return null
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    // Reject non-printable control chars (tab/newline/carriage-return are fine).
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) return null
  }
  return text
}

async function readConfigObject(clusterId: string, ref: ResourceRef): Promise<ConfigObject> {
  if (ref.kind !== 'configmaps' && ref.kind !== 'secrets') {
    throw new Error('Data editing is available only for ConfigMaps and Secrets')
  }
  if (!ref.namespace?.trim()) throw new Error('Selected resource namespace is required')
  const gvk = GVK[ref.kind]
  if (!gvk) throw new Error(`Unknown resource kind: ${ref.kind}`)
  const obj = await objectApi(clusterId)
  return (await obj.read({
    apiVersion: gvk.apiVersion,
    kind: gvk.kind,
    metadata: { name: ref.name, namespace: ref.namespace }
  })) as ConfigObject
}

function configDataFromObject(live: ConfigObject, ref: ResourceRef): ConfigData {
  const resourceVersion = live.metadata?.resourceVersion
  if (typeof resourceVersion !== 'string' || !resourceVersion.trim()) {
    throw new Error('Resource has no version; reload it before editing')
  }
  if (ref.kind === 'secrets') {
    const data: Record<string, string> = {}
    const binaryKeys: string[] = []
    for (const [k, v] of Object.entries(live.data ?? {})) {
      const text = decodeTextSecret(v)
      if (text == null) binaryKeys.push(k)
      else data[k] = text
    }
    return { secret: true, data, binaryKeys, resourceVersion }
  }
  return {
    secret: false,
    data: live.data ?? {},
    binaryKeys: Object.keys(live.binaryData ?? {}),
    resourceVersion
  }
}

export async function getConfigData(clusterId: string, ref: ResourceRef): Promise<ConfigData> {
  try {
    return configDataFromObject(await readConfigObject(clusterId, ref), ref)
  } catch (error) {
    if (ref.kind === 'secrets')
      throw new Error('Secret data could not be loaded. Check permissions and retry.')
    throw error
  }
}

export async function applyConfigData(
  clusterId: string,
  ref: ResourceRef,
  update: ConfigDataUpdate
): Promise<ConfigDataSaveResult> {
  if (typeof update.resourceVersion !== 'string' || !update.resourceVersion.trim()) {
    throw new Error('Original resource version is required to save data')
  }
  if (!update.data || typeof update.data !== 'object' || Array.isArray(update.data)) {
    throw new Error('Data must be a key/value object')
  }
  try {
    const live = await readConfigObject(clusterId, ref)
    const current = configDataFromObject(live, ref)
    if (current.resourceVersion !== update.resourceVersion) {
      return { status: 'conflict', current }
    }
    const binaryCollision = current.binaryKeys.find((key) => Object.hasOwn(update.data, key))
    if (binaryCollision) throw new Error(`Key "${binaryCollision}" collides with a binary entry`)
    const keys = Object.keys(update.data)
    if (
      keys.length === Object.keys(current.data).length &&
      keys.every((key) => update.data[key] === current.data[key])
    ) {
      return { status: 'unchanged', current }
    }

    if (ref.kind === 'secrets') {
      // Preserve binary entries (kept as their existing base64); re-encode text entries.
      const next: Record<string, string> = {}
      for (const [key, value] of Object.entries(live.data ?? {})) {
        if (decodeTextSecret(value) == null) next[key] = value
      }
      for (const [key, value] of Object.entries(update.data)) {
        next[key] = Buffer.from(value, 'utf8').toString('base64')
      }
      live.data = next
      delete live.stringData
    } else {
      live.data = { ...update.data } // binaryData left untouched
    }
    const obj = await objectApi(clusterId)
    try {
      const saved = (await obj.replace(live)) as ConfigObject
      return { status: 'saved', current: configDataFromObject(saved, ref) }
    } catch (error) {
      if (isVersionConflict(error)) {
        return { status: 'conflict', current: await getConfigData(clusterId, ref) }
      }
      throw error
    }
  } catch (error) {
    if (ref.kind === 'secrets') {
      throw new Error('Secret data save failed. Check permissions and reload before retrying.')
    }
    throw error
  }
}
