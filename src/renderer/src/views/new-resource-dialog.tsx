import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { Button } from '@renderer/ui/components/button'
import { Icon } from '@renderer/ui/components/icon'
import { Overlay } from '@renderer/ui/components/overlay'
import { cn } from '@renderer/ui/lib/utils'
import { useThemeStore } from '@renderer/ui/stores/theme-store'

import type { ResourceRef } from '../../../shared/ipc-types'
import { lightshipCmTheme } from '../lib/cm-theme'
import { useCreateFromYaml } from '../queries/use-lightship-data'
import { useUiStore } from '../stores/ui-store'
import { WrapToggle } from './wrap-toggle'

/** apiVersion + capitalised Kind + whether it's namespaced, per sidebar resource id. */
const SEEDS: Record<string, { apiVersion: string; kind: string; namespaced: boolean }> = {
  pods: { apiVersion: 'v1', kind: 'Pod', namespaced: true },
  deployments: { apiVersion: 'apps/v1', kind: 'Deployment', namespaced: true },
  statefulsets: { apiVersion: 'apps/v1', kind: 'StatefulSet', namespaced: true },
  daemonsets: { apiVersion: 'apps/v1', kind: 'DaemonSet', namespaced: true },
  jobs: { apiVersion: 'batch/v1', kind: 'Job', namespaced: true },
  cronjobs: { apiVersion: 'batch/v1', kind: 'CronJob', namespaced: true },
  services: { apiVersion: 'v1', kind: 'Service', namespaced: true },
  ingresses: { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', namespaced: true },
  endpoints: { apiVersion: 'v1', kind: 'Endpoints', namespaced: true },
  configmaps: { apiVersion: 'v1', kind: 'ConfigMap', namespaced: true },
  secrets: { apiVersion: 'v1', kind: 'Secret', namespaced: true },
  pvc: { apiVersion: 'v1', kind: 'PersistentVolumeClaim', namespaced: true },
  pv: { apiVersion: 'v1', kind: 'PersistentVolume', namespaced: false }
}

function starterManifest(kind: string, namespace?: string): string {
  const seed = SEEDS[kind] ?? { apiVersion: 'v1', kind, namespaced: true }
  const nsLine = seed.namespaced ? `\n  namespace: ${namespace || 'default'}` : ''
  return [
    `apiVersion: ${seed.apiVersion}`,
    `kind: ${seed.kind}`,
    'metadata:',
    `  name: my-${kind.replace(/s$/, '')}${nsLine}`,
    ''
  ].join('\n')
}

const matchField = (src: string, field: string): string | undefined =>
  new RegExp(`^\\s*${field}:\\s*["']?([^"'\\s#]+)`, 'm').exec(src)?.[1]

export function NewResourceDialog({
  clusterId,
  kind,
  open,
  onClose,
  defaultNamespace
}: {
  clusterId: string
  kind: string
  open: boolean
  onClose: () => void
  defaultNamespace?: string
}) {
  const create = useCreateFromYaml(clusterId, kind)
  const readOnly = useUiStore((s) => s.readOnly)
  const isDark = useThemeStore((s) => s.resolvedTheme === 'dark')
  const cmTheme = useMemo(() => lightshipCmTheme(isDark), [isDark])

  const [draft, setDraft] = useState('')
  const [dragging, setDragging] = useState(false)
  const [wrap, setWrap] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadFile = async (file: File | undefined) => {
    if (!file) return
    create.reset() // clear any prior create error
    setDraft(await file.text())
  }

  // Re-seed the editor (and clear any prior error) each time the dialog opens.
  useEffect(() => {
    if (open) {
      setDraft(starterManifest(kind, defaultNamespace))
      create.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, defaultNamespace])

  if (!open) return null

  const runCreate = () => {
    const ref: ResourceRef = {
      kind,
      name: matchField(draft, 'name') ?? 'new-resource',
      namespace: matchField(draft, 'namespace') ?? defaultNamespace
    }
    create.mutate({ ref, yaml: draft }, { onSuccess: onClose })
  }

  return (
    <Overlay open={open} onClose={onClose}>
      <div className="flex h-[70vh] w-[680px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border-strong bg-card shadow-lg">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-chrome px-4">
          <Icon name="plus" className="h-3.5 w-3.5 text-dim" />
          <h2 className="font-mono text-[13px] font-semibold text-foreground">
            New {SEEDS[kind]?.kind ?? kind} from YAML
          </h2>
          {create.isError && (
            <span className="ml-auto truncate font-mono text-[11px] text-destructive">
              {create.error instanceof Error ? create.error.message : 'Create failed'}
            </span>
          )}
        </div>

        <div
          className={cn(
            'relative min-h-0 flex-1 overflow-hidden',
            dragging && 'ring-2 ring-inset ring-primary'
          )}
          onDragOverCapture={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault() // allow the drop
            if (!dragging) setDragging(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
          }}
          onDropCapture={(e) => {
            const file = e.dataTransfer.files?.[0]
            if (!file) return // let CodeMirror handle non-file (text) drops
            e.preventDefault()
            e.stopPropagation() // beat CodeMirror's own drop handler
            setDragging(false)
            void loadFile(file)
          }}
        >
          <CodeMirror
            value={draft}
            onChange={setDraft}
            theme={cmTheme}
            extensions={wrap ? [yaml(), EditorView.lineWrapping] : [yaml()]}
            editable={!create.isPending}
            height="100%"
            className="h-full text-[12.5px]"
            basicSetup={{ foldGutter: true }}
          />
          <WrapToggle wrap={wrap} onToggle={() => setWrap((w) => !w)} />
          {dragging && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-primary/5 font-mono text-[12px] text-primary">
              Drop file to replace
            </div>
          )}
        </div>

        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-t border-border bg-chrome px-4">
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
            onClick={() => fileRef.current?.click()}
            disabled={create.isPending}
          >
            <Icon name="upload" className="h-3.5 w-3.5" />
            Load from file…
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose} disabled={create.isPending}>
              Cancel
            </Button>
            <Button disabled={readOnly || !draft.trim() || create.isPending} onClick={runCreate}>
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
