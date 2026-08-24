import type { ReactNode } from 'react'
import { Button } from '@renderer/ui/components/button'
import { Overlay } from '@renderer/ui/components/overlay'
import { Progress } from '@renderer/ui/components/progress'

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  busy,
  progress,
  onConfirm,
  onCancel
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  progress?: { label: string; done: number; total: number }
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <Overlay open={open} onClose={onCancel}>
      <div className="w-[440px] max-w-[92vw] overflow-hidden rounded-xl border border-border-strong bg-card shadow-lg">
        <div className="p-5">
          <h2 className="font-mono text-[14px] font-semibold text-foreground">{title}</h2>
          <div className="mt-2 font-mono text-[12.5px] leading-relaxed text-muted-foreground">
            {message}
          </div>
          {progress && progress.total > 1 && (
            <div className="mt-4">
              <div className="flex items-center justify-between font-mono text-[12px] text-dim">
                <span>{progress.label}…</span>
                <span>
                  {progress.done} / {progress.total}
                </span>
              </div>
              <Progress value={progress.done} max={progress.total} className="mt-1.5" />
            </div>
          )}
        </div>
        <div className="flex h-14 items-center justify-end gap-2 border-t border-border bg-chrome px-4">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'destructive' : 'default'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </Overlay>
  )
}
