import { useEffect, useMemo, useState } from 'react'
import { yaml } from '@codemirror/lang-yaml'
import CodeMirror from '@uiw/react-codemirror'
import { Button } from '@renderer/ui/components/button'
import { Icon } from '@renderer/ui/components/icon'
import { Input } from '@renderer/ui/components/input'
import { Overlay } from '@renderer/ui/components/overlay'
import { Tabs } from '@renderer/ui/components/tabs'
import { useThemeStore } from '@renderer/ui/stores/theme-store'

import { isValidLabelKey, isValidLabelValue, isValidNamespaceName } from '../../../shared/ipc-types'
import { lightshipCmTheme } from '../lib/cm-theme'
import { useCreateNamespace } from '../queries/use-lightship-data'
import { useUiStore } from '../stores/ui-store'

const YAML_SEED = `apiVersion: v1
kind: Namespace
metadata:
  name: my-namespace
  labels:
    team: platform
`

export function NewNamespaceDialog({
  clusterId,
  open,
  onClose
}: {
  clusterId: string
  open: boolean
  onClose: () => void
}) {
  const create = useCreateNamespace(clusterId)
  const readOnly = useUiStore((state) => state.readOnly)
  const isDark = useThemeStore((state) => state.resolvedTheme === 'dark')
  const theme = useMemo(() => lightshipCmTheme(isDark), [isDark])
  const [mode, setMode] = useState('form')
  const [name, setName] = useState('')
  const [labels, setLabels] = useState<Array<{ key: string; value: string }>>([])
  const [yamlDraft, setYamlDraft] = useState(YAML_SEED)

  useEffect(() => {
    if (!open) return
    setMode('form')
    setName('')
    setLabels([])
    setYamlDraft(YAML_SEED)
    create.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null
  const labelKeys = labels.map((label) => label.key)
  const labelsValid =
    new Set(labelKeys).size === labelKeys.length &&
    labels.every(
      (label) => label.key && isValidLabelKey(label.key) && isValidLabelValue(label.value)
    )
  const formValid = isValidNamespaceName(name) && labelsValid
  const submit = (): void => {
    const input =
      mode === 'form'
        ? {
            mode: 'form' as const,
            name,
            labels: Object.fromEntries(labels.map((label) => [label.key, label.value]))
          }
        : { mode: 'yaml' as const, yaml: yamlDraft }
    create.mutate(input, { onSuccess: onClose })
  }

  return (
    <Overlay open={open} onClose={onClose}>
      <div className="flex h-[68vh] w-[680px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border-strong bg-card shadow-lg">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-chrome px-4">
          <Icon name="folder" className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-[13px] font-semibold">Create namespace</h2>
          <Tabs
            className="ml-auto"
            variant="segment"
            value={mode}
            onChange={setMode}
            tabs={[
              { value: 'form', label: 'Form' },
              { value: 'yaml', label: 'YAML' }
            ]}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {mode === 'form' ? (
            <div className="space-y-5 p-5 font-mono text-[12px]">
              <label className="block text-muted-foreground">
                Namespace name
                <Input
                  className="mt-1.5"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="team-production"
                  autoFocus
                />
                {name && !isValidNamespaceName(name) && (
                  <span className="mt-1 block text-destructive">
                    Use lowercase letters, numbers, and hyphens; start and end with a letter or
                    number.
                  </span>
                )}
              </label>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-muted-foreground">Labels</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLabels((current) => [...current, { key: '', value: '' }])}
                  >
                    <Icon name="plus" className="h-3.5 w-3.5" />
                    Add label
                  </Button>
                </div>
                {labels.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-6 text-center text-dim">
                    No labels
                  </div>
                ) : (
                  <div className="space-y-2">
                    {labels.map((label, index) => (
                      <div key={index} className="flex gap-2">
                        <Input
                          aria-label={`Label ${index + 1} key`}
                          value={label.key}
                          placeholder="key"
                          onChange={(event) =>
                            setLabels((current) =>
                              current.map((item, i) =>
                                i === index ? { ...item, key: event.target.value } : item
                              )
                            )
                          }
                        />
                        <Input
                          aria-label={`Label ${index + 1} value`}
                          value={label.value}
                          placeholder="value"
                          onChange={(event) =>
                            setLabels((current) =>
                              current.map((item, i) =>
                                i === index ? { ...item, value: event.target.value } : item
                              )
                            )
                          }
                        />
                        <Button
                          aria-label="Remove label"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setLabels((current) => current.filter((_, i) => i !== index))
                          }
                        >
                          <Icon name="x" className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    {!labelsValid && (
                      <div className="text-destructive">
                        Label keys must be unique, and all keys and values must be valid.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <CodeMirror
              value={yamlDraft}
              onChange={setYamlDraft}
              theme={theme}
              extensions={[yaml()]}
              height="100%"
              className="h-full text-[12.5px]"
            />
          )}
        </div>
        <div className="flex h-14 shrink-0 items-center border-t border-border bg-chrome px-4">
          {create.isError && (
            <span className="max-w-[400px] truncate font-mono text-[11px] text-destructive">
              {create.error instanceof Error ? create.error.message : 'Create failed'}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={create.isPending}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={
                readOnly || create.isPending || (mode === 'form' ? !formValid : !yamlDraft.trim())
              }
            >
              {create.isPending ? 'Creating…' : 'Create namespace'}
            </Button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
