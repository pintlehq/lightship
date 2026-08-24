import { useCallback, useEffect, useState } from 'react'

import type { LogLine, LogStreamOptions, ResourceRef } from '../../../shared/ipc-types'
import { clusterApi, hasBackend } from './ipc'

const MAX_LINES = 5000

export type LogStatus = 'connecting' | 'streaming' | 'error' | 'ended'

// Sample lines for the no-backend (plain browser) simulated feed.
const MOCK_MSGS = [
  'GET /v1/checkout/session 200 · 24ms',
  'cache hit user:1042 region=eu',
  'outbound|443||payments.svc connected',
  'POST /v1/checkout/confirm 201 · 88ms',
  'WARN retrying upstream payments (attempt 2)',
  'mTLS handshake ok · spiffe://checkout',
  'reconcile loop complete · 312 keys',
  'flushed 2 batches to kafka topic=orders'
]

const refKeyOf = (r: ResourceRef): string => `${r.kind}/${r.namespace ?? ''}/${r.name}`

/** Live pod logs as an append stream, multiplexed across one or more targets
 *  (a single pod/workload, or a set of selected pods). Uses the real backend
 *  when present (Electron) — one stream per ref, merged into one buffer (each line
 *  carries its pod/container) — otherwise a simulated live feed so the design demos. */
export function usePodLogs(
  clusterId: string | null,
  refs: ResourceRef[],
  opts: LogStreamOptions = {}
) {
  const [lines, setLines] = useState<LogLine[]>([])
  const [status, setStatus] = useState<LogStatus>('connecting')
  const [paused, setPaused] = useState(false)

  const append = useCallback((items: LogLine[]) => {
    setLines((prev) => {
      const next = prev.concat(items)
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
    })
  }, [])

  const clear = useCallback(() => setLines([]), [])

  // Restart the streams whenever the targets / cluster change or pause toggles.
  // refs/opts are rebuilt each render, so key on their stable contents.
  const refsKey = refs.map(refKeyOf).join('|')
  const optsKey = `${opts.tailLines ?? ''}/${opts.container ?? ''}`

  // Drop the previous target's lines the instant we retarget, so switching tabs
  // shows the "connecting…" / "Waiting for logs…" state instead of stale logs
  // while the new stream connects. Keyed on target identity only — NOT `paused`,
  // so pause/resume keeps the buffer.
  useEffect(() => {
    setLines([])
  }, [clusterId, refsKey, optsKey])

  useEffect(() => {
    if (paused) return
    setStatus('connecting')
    if (refs.length === 0) return

    if (hasBackend()) {
      if (!clusterId) {
        setStatus('error')
        return
      }
      // Aggregate per-stream status into one indicator.
      const perRef: LogStatus[] = refs.map(() => 'connecting')
      const recompute = (): void => {
        if (perRef.some((s) => s === 'streaming')) setStatus('streaming')
        else if (perRef.every((s) => s === 'ended')) setStatus('ended')
        else if (perRef.some((s) => s === 'error')) setStatus('error')
        else setStatus('connecting')
      }
      const unsubs = refs.map((ref, i) =>
        clusterApi.streamLogs(clusterId, ref, opts, (ev) => {
          if (ev.type === 'lines') {
            perRef[i] = 'streaming'
            append(ev.items)
          } else if (ev.type === 'error') {
            perRef[i] = 'error'
          } else {
            perRef[i] = 'ended'
          }
          recompute()
        })
      )
      return () => unsubs.forEach((u) => u())
    }

    // Simulated live feed (no backend).
    setStatus('streaming')
    const timer = setInterval(() => {
      const ref = refs[Math.floor(Math.random() * refs.length)]
      const suffix = ref.kind === 'pods' ? '' : `-${Math.random().toString(36).slice(2, 7)}`
      append([
        {
          pod: `${ref.name}${suffix}`,
          container: 'app',
          ts: new Date().toISOString(),
          msg: MOCK_MSGS[Math.floor(Math.random() * MOCK_MSGS.length)]
        }
      ])
    }, 900)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterId, refsKey, optsKey, paused, append])

  return { lines, status, paused, setPaused, clear }
}
