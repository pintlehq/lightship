import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { Badge } from '@renderer/ui/components/badge'
import { Button } from '@renderer/ui/components/button'
import { Dot } from '@renderer/ui/components/dot'
import { Icon } from '@renderer/ui/components/icon'
import { Input } from '@renderer/ui/components/input'
import { cn } from '@renderer/ui/lib/utils'
import { useThemeStore } from '@renderer/ui/stores/theme-store'

import type { ResourceRef } from '../../../shared/ipc-types'
import { lightshipCmTheme } from '../lib/cm-theme'
import { useApplyConfigData, useConfigData } from '../queries/use-lightship-data'
import { useUiStore } from '../stores/ui-store'
import { ConfirmDialog } from './confirm-dialog'

interface Row {
  id: number
  key: string
  value: string
}

const KEY_RE = /^[A-Za-z0-9._-]+$/
const serialize = (rows: Row[]) => JSON.stringify(rows.map((r) => [r.key, r.value]))
const toRows = (data: Record<string, string>, next: () => number): Row[] =>
  Object.entries(data)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => ({ id: next(), key, value }))

export function ConfigDataEditor({
  clusterId,
  refTarget,
  secret
}: {
  clusterId: string
  refTarget: ResourceRef
  secret: boolean
}) {
  const { data, isLoading, isError, error } = useConfigData(clusterId, refTarget)
  const apply = useApplyConfigData(clusterId, refTarget)
  const readOnly = useUiStore((s) => s.readOnly)
  const isDark = useThemeStore((s) => s.resolvedTheme === 'dark')

  const [rows, setRows] = useState<Row[]>([])
  const [binaryKeys, setBinaryKeys] = useState<string[]>([])
  const [baseline, setBaseline] = useState(() => serialize([]))
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set())
  const [confirm, setConfirm] = useState(false)

  const rowsRef = useRef(rows)
  const baselineRef = useRef(baseline)
  const selectedIdRef = useRef(selectedId)
  rowsRef.current = rows
  baselineRef.current = baseline
  selectedIdRef.current = selectedId
  const idRef = useRef(0)
  const nextId = () => idRef.current++
  const fileRef = useRef<HTMLInputElement>(null)

  const cmTheme = useMemo(() => lightshipCmTheme(isDark), [isDark])
  const dirty = serialize(rows) !== baseline
  const selected = rows.find((r) => r.id === selectedId) ?? null

  // Seed from server data only when there are no unsaved edits, preserving the
  // selected key across refetches.
  useEffect(() => {
    if (!data) return
    if (serialize(rowsRef.current) === baselineRef.current) {
      const next = toRows(data.data, nextId)
      setRows(next)
      setBinaryKeys(data.binaryKeys)
      setBaseline(serialize(next))
      const prevKey = rowsRef.current.find((r) => r.id === selectedIdRef.current)?.key
      const keep = prevKey != null ? next.find((r) => r.key === prevKey) : undefined
      setSelectedId((keep ?? next[0])?.id ?? null)
    }
  }, [data])

  const validationError = useMemo(() => {
    const seen = new Set<string>()
    for (const r of rows) {
      if (!r.key) return 'Keys cannot be empty'
      if (!KEY_RE.test(r.key)) return `Invalid key "${r.key}" — use letters, numbers, . _ -`
      if (seen.has(r.key)) return `Duplicate key "${r.key}"`
      seen.add(r.key)
      if (binaryKeys.includes(r.key)) return `Key "${r.key}" collides with a binary entry`
    }
    return null
  }, [rows, binaryKeys])

  const patch = (id: number, field: 'key' | 'value', v: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: v } : r)))

  const reveal = (id: number) =>
    setRevealed((s) => {
      const next = new Set(s)
      next.add(id)
      return next
    })

  const addRow = () => {
    const id = nextId()
    setRows((rs) => [...rs, { id, key: '', value: '' }])
    setSelectedId(id)
    reveal(id)
  }

  const removeRow = (id: number) => {
    const idx = rows.findIndex((r) => r.id === id)
    const next = rows.filter((r) => r.id !== id)
    setRows(next)
    if (selectedId === id) setSelectedId(next[idx]?.id ?? next[idx - 1]?.id ?? null)
  }

  const reset = () => {
    if (!data) return
    const next = toRows(data.data, nextId)
    setRows(next)
    setSelectedId(next[0]?.id ?? null)
  }

  const onUpload = async (file: File | undefined) => {
    if (!file || !selected) return
    patch(selected.id, 'value', await file.text())
    reveal(selected.id)
  }

  const runApply = () => {
    apply.mutate(Object.fromEntries(rows.map((r) => [r.key, r.value])), {
      onSuccess: () => {
        setBaseline(serialize(rows))
        setConfirm(false)
      }
    })
  }

  const hidden = secret && selected != null && !revealed.has(selected.id)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center gap-2 border-b border-border bg-chrome px-3">
        {dirty ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-primary">
            <Dot tone="primary" />
            unsaved changes
          </span>
        ) : (
          <span className="font-mono text-[11px] text-dim">
            {isLoading ? 'loading…' : `${rows.length} ${rows.length === 1 ? 'key' : 'keys'}`}
          </span>
        )}
        {(apply.isError || validationError) && (
          <span className="truncate font-mono text-[11px] text-destructive">
            {validationError ??
              (apply.error instanceof Error ? apply.error.message : 'Apply failed')}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="default"
            disabled={!dirty || apply.isPending}
            onClick={reset}
          >
            Reset
          </Button>
          <Button
            size="default"
            disabled={readOnly || !dirty || !!validationError || apply.isPending}
            onClick={() => setConfirm(true)}
          >
            <Icon name="check" className="h-3.5 w-3.5" />
            Apply
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid flex-1 place-items-center font-mono text-[12.5px] text-dim">
          Loading data…
        </div>
      ) : isError ? (
        <div className="grid flex-1 place-items-center gap-2 p-6 text-center font-mono text-[12.5px] text-destructive">
          <Icon name="x" className="h-7 w-7" />
          <span>{error instanceof Error ? error.message : 'Failed to load data'}</span>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Left: key list */}
          <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-chrome">
            <div className="min-h-0 flex-1 overflow-auto py-1">
              {rows.map((r) => (
                <div
                  key={r.id}
                  className={cn(
                    'group flex items-center gap-1 px-2',
                    r.id === selectedId ? 'bg-active' : 'hover:bg-hover'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className="flex-1 truncate py-1.5 text-left font-mono text-[12.5px] text-foreground"
                  >
                    {r.key || <span className="text-faint">(new key)</span>}
                  </button>
                  <button
                    type="button"
                    title="Remove field"
                    onClick={() => removeRow(r.id)}
                    className="shrink-0 rounded p-1 text-destructive opacity-0 transition-opacity hover:bg-destructive/10 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {binaryKeys.map((k) => (
                <div
                  key={`bin:${k}`}
                  className="flex items-center gap-1.5 px-2 py-1.5 font-mono text-[12.5px] text-dim opacity-70"
                >
                  <span className="flex-1 truncate">{k}</span>
                  <Badge variant="secondary">binary</Badge>
                </div>
              ))}
              {rows.length === 0 && binaryKeys.length === 0 && (
                <div className="px-2 py-6 text-center font-mono text-[12px] text-dim">No keys.</div>
              )}
            </div>
            <div className="border-t border-border p-2">
              <Button variant="outline" size="default" className="w-full" onClick={addRow}>
                <Icon name="plus" className="h-3.5 w-3.5" />
                Add field
              </Button>
            </div>
          </aside>

          {/* Right: value editor */}
          <div className="flex min-w-0 flex-1 flex-col">
            {selected ? (
              <>
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <Input
                    value={selected.key}
                    onChange={(e) => patch(selected.id, 'key', e.target.value)}
                    placeholder="KEY"
                    className="max-w-xs flex-1"
                  />
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      void onUpload(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                  <Button variant="outline" size="default" onClick={() => fileRef.current?.click()}>
                    <Icon name="upload" className="h-3.5 w-3.5" />
                    Upload
                  </Button>
                  {secret && (
                    <Button
                      variant="outline"
                      size="icon"
                      title={hidden ? 'Reveal value' : 'Hide value'}
                      onClick={() =>
                        setRevealed((s) => {
                          const next = new Set(s)
                          if (next.has(selected.id)) next.delete(selected.id)
                          else next.add(selected.id)
                          return next
                        })
                      }
                    >
                      <Icon name="eye" className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {secret && (
                  <p className="border-b border-border px-3 py-1 font-mono text-[10.5px] text-faint">
                    base64-decoded — re-encoded on apply
                  </p>
                )}
                <div className="min-h-0 flex-1 overflow-hidden">
                  {hidden ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                      <Icon name="lock" className="h-5 w-5 text-faint" />
                      <span className="font-mono text-[12.5px] text-dim">Value hidden</span>
                      <Button variant="outline" size="default" onClick={() => reveal(selected.id)}>
                        <Icon name="eye" className="h-3.5 w-3.5" />
                        Reveal to view / edit
                      </Button>
                    </div>
                  ) : (
                    <CodeMirror
                      value={selected.value}
                      onChange={(v) => patch(selected.id, 'value', v)}
                      theme={cmTheme}
                      editable={!apply.isPending}
                      height="100%"
                      className="h-full text-[12.5px]"
                      basicSetup={{ highlightActiveLine: false }}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="grid h-full place-items-center font-mono text-[12.5px] text-dim">
                Select a key, or add a field.
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        busy={apply.isPending}
        title={`Apply data changes to ${refTarget.name}?`}
        message="This replaces the resource's data on the live cluster. A stale edit will be rejected."
        confirmLabel="Apply"
        onConfirm={runApply}
        onCancel={() => setConfirm(false)}
      />
    </div>
  )
}
