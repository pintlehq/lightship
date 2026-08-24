import { gunzipSync } from 'node:zlib'

import type { HelmRelease } from '../../shared/ipc-types'
import { ageOf, kcForCluster, loadK8s } from './k8s'

// Helm 3 stores each release revision in a Secret (type helm.sh/release.v1,
// label owner=helm). `data.release` is base64(base64(gzip(json))) — the k8s API
// base64-encodes the secret value, and Helm itself stored base64(gzip(json)).

/** The shape we read out of a decoded Helm release payload. */
type DecodedRelease = {
  name?: string
  namespace?: string
  version?: number
  info?: { status?: string; last_deployed?: string }
  chart?: { metadata?: { name?: string; version?: string; appVersion?: string } }
}

/** Decode a Helm release Secret's `data.release` value to its release JSON.
 *  Handles both the standard double-base64+gzip and a single-base64 fallback. */
export function decodeRelease(b64: string): DecodedRelease {
  let buf = Buffer.from(b64, 'base64')
  // After the k8s base64 layer we usually have an ASCII base64 string of gzip;
  // decode again unless it's already gzip (magic bytes 0x1f 0x8b).
  if (!(buf[0] === 0x1f && buf[1] === 0x8b)) {
    buf = Buffer.from(buf.toString('utf8'), 'base64')
  }
  return JSON.parse(gunzipSync(buf).toString('utf8')) as DecodedRelease
}

function toRow(r: DecodedRelease): HelmRelease {
  const meta = r.chart?.metadata
  return {
    name: r.name ?? '',
    namespace: r.namespace ?? '',
    revision: r.version ?? 0,
    chart: meta?.name ?? '',
    chartVersion: meta?.version ?? '',
    appVersion: meta?.appVersion ?? '',
    status: r.info?.status ?? '',
    updated: ageOf(r.info?.last_deployed)
  }
}

/** Decode every helm release Secret matching `labelSelector` for the cluster. */
async function decodeReleases(clusterId: string, labelSelector: string): Promise<DecodedRelease[]> {
  const { CoreV1Api } = await loadK8s()
  const kc = await kcForCluster(clusterId)
  const res = await kc.makeApiClient(CoreV1Api).listSecretForAllNamespaces({ labelSelector })
  const out: DecodedRelease[] = []
  for (const s of res.items) {
    const raw = s.data?.release
    if (!raw) continue
    try {
      out.push(decodeRelease(raw))
    } catch {
      /* skip a release we can't decode */
    }
  }
  return out
}

/** Installed releases — one row per release at its latest revision. */
export async function listHelmReleases(clusterId: string): Promise<HelmRelease[]> {
  const releases = await decodeReleases(clusterId, 'owner=helm')
  const latest = new Map<string, DecodedRelease>()
  for (const r of releases) {
    const key = `${r.namespace ?? ''}/${r.name ?? ''}`
    const prev = latest.get(key)
    if (!prev || (r.version ?? 0) > (prev.version ?? 0)) latest.set(key, r)
  }
  return [...latest.values()]
    .map(toRow)
    .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name))
}

/** Every stored revision of one release, newest first. */
export async function listHelmRevisions(
  clusterId: string,
  namespace: string,
  name: string
): Promise<HelmRelease[]> {
  const releases = await decodeReleases(clusterId, `owner=helm,name=${name}`)
  return releases
    .filter((r) => (r.namespace ?? '') === namespace)
    .map(toRow)
    .sort((a, b) => b.revision - a.revision)
}
