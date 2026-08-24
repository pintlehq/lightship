import { useEffect, useState } from 'react'
import { Button } from '@renderer/ui/components/button'
import { Dot } from '@renderer/ui/components/dot'
import { Icon } from '@renderer/ui/components/icon'
import { Input } from '@renderer/ui/components/input'
import { Overlay } from '@renderer/ui/components/overlay'
import { cn } from '@renderer/ui/lib/utils'

import type { PortInfo, ResourceRef } from '../../../shared/ipc-types'
import { usePortForwardsStore } from '../stores/port-forwards-store'

export function PortForwardDialog({
  clusterId,
  open,
  onClose,
  refTarget,
  name,
  ports
}: {
  clusterId: string
  open: boolean
  onClose: () => void
  refTarget: ResourceRef
  name: string
  ports?: PortInfo[]
}) {
  const start = usePortForwardsStore((s) => s.start)
  const [remote, setRemote] = useState('')
  const [local, setLocal] = useState('')
  const [startedId, setStartedId] = useState<string | null>(null)
  const session = usePortForwardsStore((s) =>
    startedId ? s.sessions.find((t) => t.id === startedId) : undefined
  )

  useEffect(() => {
    if (open) {
      setRemote(ports && ports.length ? String(ports[0].port) : '')
      setLocal('') // blank → OS-assigned (auto)
      setStartedId(null)
    }
  }, [open, ports])

  if (!open) return null

  const pick = (port: number): void => setRemote(String(port))

  const remotePort = parseInt(remote, 10)
  const valid = !!clusterId && Number.isFinite(remotePort) && remotePort > 0

  const close = (): void => {
    setStartedId(null)
    onClose()
  }
  const submit = (): void => {
    if (!valid) return
    setStartedId(
      start({
        clusterId: clusterId!,
        ref: refTarget,
        name,
        remotePort,
        localPort: parseInt(local, 10) || 0 // 0 → OS-assigned
      })
    )
  }

  // --- result phase (after Start) ---
  if (startedId) {
    const running = session?.status === 'running'
    const url = session ? `http://localhost:${session.localPort}` : ''
    return (
      <Overlay open={open} onClose={close}>
        <div className="w-[420px] max-w-[92vw] overflow-hidden rounded-xl border border-border-strong bg-card shadow-lg">
          <div className="p-5">
            <h2 className="font-mono text-[14px] font-semibold text-foreground">Forward port</h2>
            <p className="mt-1 font-mono text-[12px] text-dim">{`${refTarget.kind}/${name} · ${remotePort}`}</p>
            <div className="mt-4">
              {!session || session.status === 'starting' ? (
                <span className="inline-flex items-center gap-2 font-mono text-[12.5px] text-dim">
                  <Dot tone="dim" pulse />
                  Starting forward…
                </span>
              ) : session.status === 'error' ? (
                <span className="font-mono text-[12.5px] text-destructive">
                  {session.error ?? 'Failed to start forward'}
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <Dot tone={running ? 'success' : 'warning'} pulse={running} />
                  <span className="font-mono text-[13px] text-foreground">{url}</span>
                  <button
                    type="button"
                    title="Copy URL"
                    onClick={() => void navigator.clipboard?.writeText(url)}
                    className="grid h-6 w-6 place-items-center rounded text-dim hover:bg-hover hover:text-foreground"
                  >
                    <Icon name="copy" className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex h-14 items-center justify-end gap-2 border-t border-border bg-chrome px-4">
            <Button variant="outline" onClick={close}>
              Done
            </Button>
            <Button disabled={!running} onClick={() => void window.api?.window?.openExternal(url)}>
              <Icon name="link" className="h-3.5 w-3.5" />
              Open in browser
            </Button>
          </div>
        </div>
      </Overlay>
    )
  }

  return (
    <Overlay open={open} onClose={close}>
      <div className="w-[420px] max-w-[92vw] overflow-hidden rounded-xl border border-border-strong bg-card shadow-lg">
        <div className="p-5">
          <h2 className="font-mono text-[14px] font-semibold text-foreground">Forward port</h2>
          <p className="mt-1 font-mono text-[12px] text-dim">{`${refTarget.kind}/${name}`}</p>
          {ports && ports.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 font-mono text-[11px] text-dim">Suggested ports</div>
              <div className="flex flex-wrap gap-1.5">
                {ports.map((p) => (
                  <button
                    key={`${p.name ?? ''}-${p.port}`}
                    type="button"
                    onClick={() => pick(p.port)}
                    className={cn(
                      'rounded border px-2 py-1 font-mono text-[11.5px] transition-colors',
                      remote === String(p.port)
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-background text-muted-foreground hover:border-border-strong hover:text-foreground'
                    )}
                  >
                    {p.name ? `${p.name} ` : ''}
                    {p.port}
                    {p.protocol && p.protocol !== 'TCP' ? `/${p.protocol}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="font-mono text-[11px] text-dim">
              Remote port
              <Input
                value={remote}
                onChange={(e) => setRemote(e.target.value.replace(/\D/g, ''))}
                placeholder="80"
                className="mt-1"
                autoFocus
              />
            </label>
            <label className="font-mono text-[11px] text-dim">
              Local port (blank = auto)
              <Input
                value={local}
                onChange={(e) => setLocal(e.target.value.replace(/\D/g, ''))}
                placeholder="auto"
                className="mt-1"
              />
            </label>
          </div>
        </div>
        <div className="flex h-14 items-center justify-end gap-2 border-t border-border bg-chrome px-4">
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={submit}>
            Start forward
          </Button>
        </div>
      </div>
    </Overlay>
  )
}
