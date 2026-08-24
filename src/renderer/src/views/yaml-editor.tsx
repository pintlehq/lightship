import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { Button } from '@renderer/ui/components/button'
import { Dot } from '@renderer/ui/components/dot'
import { Icon } from '@renderer/ui/components/icon'
import { useThemeStore } from '@renderer/ui/stores/theme-store'

import type { ResourceRef } from '../../../shared/ipc-types'
import { lightshipCmTheme } from '../lib/cm-theme'
import { useApplyYaml, useResourceYaml } from '../queries/use-lightship-data'
import { useUiStore } from '../stores/ui-store'
import { ConfirmDialog } from './confirm-dialog'
import { WrapToggle } from './wrap-toggle'

export function YamlEditor({
  clusterId,
  refTarget
}: {
  clusterId: string
  refTarget: ResourceRef
}) {
  const { data, isLoading, isError, error } = useResourceYaml(clusterId, refTarget)
  const apply = useApplyYaml(clusterId, refTarget)
  const readOnly = useUiStore((s) => s.readOnly)
  const isDark = useThemeStore((s) => s.resolvedTheme === 'dark')

  const [draft, setDraft] = useState('')
  const [baseline, setBaseline] = useState('')
  const draftRef = useRef('')
  const baselineRef = useRef('')
  draftRef.current = draft
  baselineRef.current = baseline
  const dirty = draft !== baseline

  const [confirm, setConfirm] = useState(false)
  const [wrap, setWrap] = useState(true)

  // Adopt fresh server YAML only when there are no unsaved edits (refs keep this
  // effect off the draft/baseline deps so typing never re-triggers it).
  useEffect(() => {
    if (data == null) return
    if (draftRef.current === baselineRef.current) {
      setDraft(data)
      setBaseline(data)
    }
  }, [data])

  const cmTheme = useMemo(() => lightshipCmTheme(isDark), [isDark])

  const runApply = () => {
    apply.mutate(draft, {
      onSuccess: () => {
        setBaseline(draft)
        setConfirm(false)
      }
    })
  }

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
            {isLoading ? 'loading…' : `${refTarget.kind}/${refTarget.name}`}
          </span>
        )}
        {apply.isError && (
          <span className="truncate font-mono text-[11px] text-destructive">
            {apply.error instanceof Error ? apply.error.message : 'Apply failed'}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="default"
            disabled={!dirty || apply.isPending}
            onClick={() => setDraft(baseline)}
          >
            Reset
          </Button>
          <Button
            size="default"
            disabled={readOnly || !dirty || apply.isPending}
            onClick={() => setConfirm(true)}
          >
            <Icon name="check" className="h-3.5 w-3.5" />
            Apply
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {isError ? (
          <div className="grid h-full place-items-center gap-2 p-6 text-center font-mono text-[12.5px] text-destructive">
            <Icon name="x" className="h-7 w-7" />
            <span>{error instanceof Error ? error.message : 'Failed to load manifest'}</span>
          </div>
        ) : (
          <>
            <CodeMirror
              value={draft}
              onChange={setDraft}
              theme={cmTheme}
              extensions={wrap ? [yaml(), EditorView.lineWrapping] : [yaml()]}
              editable={!apply.isPending}
              height="100%"
              className="h-full text-[12.5px]"
              basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly }}
            />
            <WrapToggle wrap={wrap} onToggle={() => setWrap((w) => !w)} />
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirm}
        busy={apply.isPending}
        title={`Apply changes to ${refTarget.name}?`}
        message="This applies your edited manifest to the live cluster, replacing the current object. A stale edit will be rejected."
        confirmLabel="Apply"
        onConfirm={runApply}
        onCancel={() => setConfirm(false)}
      />
    </div>
  )
}
