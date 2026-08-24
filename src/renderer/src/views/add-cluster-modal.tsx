import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@renderer/ui/components/badge'
import { Button } from '@renderer/ui/components/button'
import { Checkbox } from '@renderer/ui/components/checkbox'
import { Icon } from '@renderer/ui/components/icon'
import { Overlay } from '@renderer/ui/components/overlay'
import { Tabs } from '@renderer/ui/components/tabs'
import { cn } from '@renderer/ui/lib/utils'

import type { DetectedContext } from '../../../shared/ipc-types'
import { ClusterAddSelectionArraySchema } from '../../../shared/ipc-types'
import { clustersApi } from '../lib/ipc'

type SourceTab = 'kubeconfig' | 'paste'

function ContextRow({
  ctx,
  checked,
  onToggle
}: {
  ctx: DetectedContext
  checked: boolean
  onToggle: () => void
}) {
  const disabled = !!ctx.alreadyAdded
  return (
    <label
      className={cn(
        'flex w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 font-mono transition-colors last:border-0',
        disabled ? 'cursor-default opacity-50' : 'cursor-pointer hover:bg-hover'
      )}
    >
      <Checkbox checked={checked} disabled={disabled} onChange={onToggle} />
      <Icon name="server" className="h-3.5 w-3.5 text-primary" />
      <span className="text-[12.5px] text-foreground">{ctx.name}</span>
      <span className="truncate text-[11px] text-faint">{ctx.server || ctx.cluster}</span>
      {disabled && (
        <Badge variant="secondary" className="ml-auto px-1 py-0 text-[9px] uppercase">
          added
        </Badge>
      )}
    </label>
  )
}

export function AddClusterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<SourceTab>('kubeconfig')
  const [contexts, setContexts] = useState<DetectedContext[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [paste, setPaste] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Detect contexts from ~/.kube/config when the modal opens on the kubeconfig tab.
  useEffect(() => {
    if (!open) return
    setError(null)
    setPicked(new Set())
    if (tab === 'kubeconfig') {
      setLoading(true)
      clustersApi
        .detect()
        .then(setContexts)
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false))
    } else {
      setContexts([])
    }
  }, [open, tab])

  // Auto-parse the pasted kubeconfig as the user edits (debounced).
  useEffect(() => {
    if (!open || tab !== 'paste') return
    if (!paste.trim()) {
      setContexts([])
      setPicked(new Set())
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const id = setTimeout(() => {
      clustersApi
        .parse(paste)
        .then((cs) => {
          setContexts(cs)
          setPicked(new Set())
        })
        .catch((e) => {
          setContexts([])
          setError(e instanceof Error ? e.message : String(e))
        })
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(id)
  }, [open, tab, paste])

  if (!open) return null

  const loadFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setPaste(await file.text())
  }

  const togglePick = (name: string) =>
    setPicked((s) => {
      const next = new Set(s)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })

  const count = picked.size

  const onAdd = async () => {
    setAdding(true)
    setError(null)
    try {
      const selections = [...picked].map((context) =>
        tab === 'paste' ? { context, kubeconfig: paste } : { context }
      )
      // Validate the selection payload against the shared schema before IPC.
      const parsed = ClusterAddSelectionArraySchema.safeParse(selections)
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Invalid cluster selection')
        return
      }
      await clustersApi.add(parsed.data)
      await qc.invalidateQueries({ queryKey: ['clusters'] })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAdding(false)
    }
  }

  const alreadyAdded = contexts.filter((c) => c.alreadyAdded).length

  return (
    <Overlay open={open} onClose={onClose}>
      <div className="grid max-h-[86vh] w-[680px] max-w-[92vw] grid-rows-[auto_1fr_auto] overflow-hidden rounded-xl border border-border-strong bg-card shadow-lg">
        <div className="flex h-12 items-center justify-between border-b border-border bg-chrome px-4">
          <span className="inline-flex items-center gap-2 font-mono text-[13px] font-semibold tracking-tight">
            <Icon name="server" className="h-4 w-4 text-primary" />
            Add cluster
          </span>
          <button
            type="button"
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <Tabs
            variant="segment"
            value={tab}
            onChange={(v) => setTab(v as SourceTab)}
            className="flex w-full [&>button]:flex-1"
            tabs={[
              { value: 'kubeconfig', label: 'kubeconfig', icon: 'file' },
              { value: 'paste', label: 'paste YAML', icon: 'code' }
            ]}
          />

          {tab === 'paste' && (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  Paste a raw kubeconfig. Credentials are encrypted with the OS keychain
                  (safeStorage), never stored on disk in plaintext.
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    void loadFile(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => fileRef.current?.click()}
                  disabled={loading}
                >
                  <Icon name="upload" className="h-3 w-3" />
                  Load from file…
                </Button>
              </div>
              <textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder={
                  'apiVersion: v1\nkind: Config\nclusters:\n  - name: my-cluster\n    cluster:\n      server: https://…'
                }
                className="h-[160px] w-full resize-none rounded-lg border border-input bg-background p-3 font-mono text-[12px] leading-relaxed text-foreground outline-none placeholder:text-faint focus:border-primary focus:ring-2 focus:ring-ring/30"
              />
            </div>
          )}

          {tab === 'kubeconfig' && (
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Detected <span className="font-medium text-foreground">~/.kube/config</span>
              {contexts.length > 0
                ? ` with ${contexts.length} context${contexts.length > 1 ? 's' : ''}.`
                : '.'}{' '}
              Pick the ones to add.
            </p>
          )}

          <div className="overflow-hidden rounded-lg border border-border">
            {loading ? (
              <div className="grid h-24 place-items-center font-mono text-[12.5px] text-dim">
                Loading…
              </div>
            ) : contexts.length === 0 ? (
              <div className="grid h-24 place-items-center font-mono text-[12.5px] text-dim">
                {tab === 'paste' ? 'Paste a kubeconfig to detect contexts' : 'No contexts found'}
              </div>
            ) : (
              contexts.map((c) => (
                <ContextRow
                  key={c.name}
                  ctx={c}
                  checked={picked.has(c.name)}
                  onToggle={() => togglePick(c.name)}
                />
              ))
            )}
          </div>

          {alreadyAdded > 0 && (
            <div className="flex items-center gap-2 font-mono text-[11px] text-dim">
              <Icon name="check" className="h-3 w-3 text-success" />
              {alreadyAdded} already connected · skipped
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 font-mono text-[12px] text-destructive">
              <Icon name="x" className="h-3.5 w-3.5" />
              {error}
            </div>
          )}
        </div>

        <div className="flex h-14 items-center justify-between gap-2 border-t border-border bg-chrome px-4">
          <span className="font-mono text-[11.5px] text-dim">
            {count > 0 ? `${count} context${count > 1 ? 's' : ''} selected` : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={onAdd} disabled={count === 0 || adding}>
              <Icon name="plus" className="h-3.5 w-3.5" />
              {adding
                ? 'Adding…'
                : count > 0
                  ? `Add ${count} cluster${count > 1 ? 's' : ''}`
                  : 'Add clusters'}
            </Button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
