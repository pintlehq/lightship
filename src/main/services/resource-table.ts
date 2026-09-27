import * as https from 'node:https'

import type { KubeConfig } from '@kubernetes/client-node'

import { type Meta } from './resource-mappers'

/** A row from the Kubernetes Table API: PartialObjectMetadata + server print-column cells
 *  (keyed by lowercased column name). Fetched without the object's heavy `.data`. */
type TableListRow = { metadata: Meta; cells: Record<string, string> }

/** List a collection via the Kubernetes **Table** API (`as=Table`) - server-rendered print
 *  columns + metadata only, so large `.data`/`.binaryData` payloads are never transferred.
 *  Uses `applyToHTTPSOptions` (auth + cluster CA/client-cert) over node `https`, the same
 *  TLS the typed client uses. */
type RawTable = {
  columnDefinitions: Array<{ name: string; priority?: number }>
  rows: Array<{ cells: unknown[]; metadata: Meta }>
}

/** Raw `as=Table` fetch for a collection path - column definitions (with their
 *  print priority) + per-row cells and object metadata. */
export async function fetchTable(kc: KubeConfig, path: string): Promise<RawTable> {
  const cluster = kc.getCurrentCluster()
  if (!cluster) throw new Error('No current cluster')
  const url = new URL(`${cluster.server}${path}`)
  const opts: https.RequestOptions = {
    method: 'GET',
    host: url.hostname,
    port: url.port || 443,
    path: url.pathname + url.search
  }
  await kc.applyToHTTPSOptions(opts)
  opts.headers = { ...opts.headers, Accept: 'application/json;as=Table;v=v1;g=meta.k8s.io' }
  const body = await new Promise<string>((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (data += c))
      res.on('end', () =>
        res.statusCode && res.statusCode >= 200 && res.statusCode < 300
          ? resolve(data)
          : reject(new Error(`Table list ${path} failed: ${res.statusCode}`))
      )
    })
    req.on('error', reject)
    req.end()
  })
  const table = JSON.parse(body) as {
    columnDefinitions?: Array<{ name: string; priority?: number }>
    rows?: Array<{ cells: unknown[]; object?: { metadata?: Meta } }>
  }
  return {
    columnDefinitions: table.columnDefinitions ?? [],
    rows: (table.rows ?? []).map((r) => ({ cells: r.cells, metadata: r.object?.metadata ?? {} }))
  }
}

export async function listViaTable(kc: KubeConfig, path: string): Promise<TableListRow[]> {
  const t = await fetchTable(kc, path)
  const names = t.columnDefinitions.map((d) => d.name.toLowerCase())
  return t.rows.map((row) => {
    const cells: Record<string, string> = {}
    names.forEach((n, i) => {
      cells[n] = row.cells[i] == null ? '' : String(row.cells[i])
    })
    return { metadata: row.metadata, cells }
  })
}
