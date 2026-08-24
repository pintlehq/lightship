import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@renderer/ui/components/button'
import { Icon } from '@renderer/ui/components/icon'
import { Input } from '@renderer/ui/components/input'
import { Overlay } from '@renderer/ui/components/overlay'
import { toast } from '@renderer/ui/components/toaster'

import type { ResourceRef, ResourceRow } from '../../../shared/ipc-types'
import { errMsg } from '../lib/errors'
import { clusterApi } from '../lib/ipc'
import { recordActivity } from '../lib/record-activity'
import { qk } from '../queries/keys'

export function desiredReplicasFromReady(ready?: string): string {
  const match = /^\s*\d+\s*\/\s*(\d+)\s*$/.exec(ready ?? '')
  return match?.[1] ?? ''
}

function replicaValue(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

export function ScaleResourceDialog({
  clusterId,
  resourceId,
  resourceLabel,
  row,
  rows,
  open,
  readOnly = false,
  onClose,
  onComplete,
  onScale
}: {
  clusterId: string
  resourceId: string
  resourceLabel?: string
  row?: ResourceRow
  rows?: ResourceRow[]
  open: boolean
  readOnly?: boolean
  onClose: () => void
  onComplete?: () => void
  onScale?: (ref: ResourceRef, replicas: number) => Promise<void>
}) {
  const qc = useQueryClient()
  const [replicas, setReplicas] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const targets = rows ?? (row ? [row] : [])
  const bulk = targets.length > 1
  const desiredValues = targets.map((r) => desiredReplicasFromReady(r.columns.ready))
  const desired =
    desiredValues.length > 0 && desiredValues.every((v) => v && v === desiredValues[0])
      ? desiredValues[0]
      : ''
  const value = replicaValue(replicas)
  const valid = value !== null
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    if (open) {
      setReplicas(desired)
      setBusy(false)
      setError(null)
      setProgress(null)
    }
  }, [open, desired])

  if (!open) return null

  const submit = async (): Promise<void> => {
    if (readOnly || busy || value === null || targets.length === 0) return
    setBusy(true)
    setError(null)
    setProgress(targets.length > 1 ? { done: 0, total: targets.length } : null)
    let ok = 0
    let failed = 0
    let lastErr: unknown = null
    try {
      for (const target of targets) {
        const ref: ResourceRef = {
          kind: resourceId,
          namespace: target.namespace,
          name: target.name
        }
        try {
          if (onScale) await onScale(ref, value)
          else await clusterApi.scaleResource(clusterId, ref, value)
          ok++
        } catch (e) {
          console.error(e)
          failed++
          lastErr = e
        }
        if (targets.length > 1) setProgress({ done: ok + failed, total: targets.length })
      }
      const first = targets[0]!
      await qc.invalidateQueries({ queryKey: qk.resource(clusterId, resourceId) })
      if (targets.length === 1 && first) {
        const ref: ResourceRef = { kind: resourceId, namespace: first.namespace, name: first.name }
        await Promise.all([
          qc.invalidateQueries({ queryKey: qk.yaml(clusterId, ref) }),
          qc.invalidateQueries({ queryKey: qk.detail(clusterId, ref) })
        ])
      }
      if (failed === targets.length) throw lastErr ?? new Error('Failed to scale')
      if (failed === 0)
        toast.success(
          bulk
            ? `Scaled ${ok} ${(resourceLabel ?? resourceId).toLowerCase()} to ${value} replicas`
            : `Scaled ${first.name} to ${value} replicas`
        )
      else toast.error(`Scaled ${ok}, ${failed} failed`, errMsg(lastErr))
      recordActivity({
        clusterId,
        action: 'scale',
        kind: resourceId,
        namespace: targets.length === 1 ? first.namespace : undefined,
        name: targets.length === 1 ? first.name : undefined,
        count: targets.length,
        outcome: failed === 0 ? 'success' : 'error',
        message:
          failed > 0
            ? `${value} replicas · ${ok} ok, ${failed} failed`
            : desired
              ? `${desired} -> ${value} replicas`
              : `${value} replicas`
      })
      onComplete?.()
      onClose()
    } catch (e) {
      const message = errMsg(e)
      setError(message)
      toast.error('Failed to scale', message)
      recordActivity({
        clusterId,
        action: 'scale',
        kind: resourceId,
        count: targets.length || 1,
        outcome: 'error',
        message: `${value} replicas · ${message}`
      })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <Overlay open={open} onClose={onClose}>
      <div className="w-[420px] max-w-[92vw] overflow-hidden rounded-xl border border-border-strong bg-card shadow-lg">
        <div className="p-5">
          <h2 className="font-mono text-[14px] font-semibold text-foreground">Scale workload</h2>
          <p className="mt-1 font-mono text-[12px] text-dim">
            {bulk
              ? `${targets.length} ${(resourceLabel ?? resourceId).toLowerCase()} selected`
              : targets[0]?.namespace
                ? `${resourceId}/${targets[0].name} · ${targets[0].namespace}`
                : `${resourceId}/${targets[0]?.name ?? ''}`}
          </p>
          <label className="mt-4 block font-mono text-[11px] text-dim">
            Replicas
            <Input
              value={replicas}
              onChange={(e) => setReplicas(e.target.value)}
              inputMode="numeric"
              autoFocus
              className="mt-1"
            />
          </label>
          {progress && (
            <p className="mt-3 font-mono text-[12px] text-dim">
              Scaling... {progress.done} / {progress.total}
            </p>
          )}
          {error && <p className="mt-3 font-mono text-[12px] text-destructive">{error}</p>}
        </div>
        <div className="flex h-14 items-center justify-end gap-2 border-t border-border bg-chrome px-4">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={readOnly || !valid || busy}>
            <Icon name="chevronsUpDown" className="h-3.5 w-3.5" />
            {busy ? 'Scaling...' : 'Scale'}
          </Button>
        </div>
      </div>
    </Overlay>
  )
}
