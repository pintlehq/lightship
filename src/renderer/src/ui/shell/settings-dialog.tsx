import * as React from 'react'

import { cn } from '@renderer/ui/lib/utils'
import { Icon, type IconName } from '@renderer/ui/components/icon'
import { Switch } from '@renderer/ui/components/switch'
import { Kbd } from '@renderer/ui/components/kbd'
import { Overlay } from '@renderer/ui/components/overlay'
import { useThemeStore, type ThemePreference } from '@renderer/ui/stores/theme-store'

export interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  product: string
}

const NAV: Array<{ id: string; label: string; icon: IconName }> = [
  { id: 'appearance', label: 'appearance', icon: 'sun' },
  { id: 'general', label: 'general', icon: 'settings' },
  { id: 'keymap', label: 'keymap', icon: 'command' },
  { id: 'about', label: 'about', icon: 'circle' }
]

export function SettingsDialog({ open, onClose, product }: SettingsDialogProps) {
  const { theme, setTheme } = useThemeStore()
  const [section, setSection] = React.useState('appearance')
  if (!open) return null

  return (
    <Overlay open={open} onClose={onClose}>
      <div className="grid h-[580px] max-h-[86vh] w-[860px] max-w-[92vw] grid-rows-[auto_1fr] overflow-hidden rounded-xl border border-border-strong bg-card shadow-lg">
        <div className="flex h-12 items-center justify-between border-b border-border bg-chrome px-4">
          <span className="font-mono text-[13px] font-semibold tracking-tight">Settings</span>
          <button
            type="button"
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        <div className="grid min-h-0 grid-cols-[200px_1fr]">
          <nav className="flex flex-col gap-0.5 overflow-y-auto border-r border-border bg-chrome p-2">
            {NAV.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setSection(n.id)}
                className={cn(
                  'relative flex h-8 items-center gap-2 rounded-md px-2.5 text-left font-mono text-xs transition-colors',
                  section === n.id
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-hover hover:text-foreground'
                )}
              >
                {section === n.id && (
                  <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />
                )}
                <Icon name={n.icon} className="h-3.5 w-3.5" />
                {n.label}
              </button>
            ))}
          </nav>
          <div className="overflow-y-auto p-6">
            {section === 'appearance' && (
              <div className="space-y-7">
                <Field title="Theme" desc="Pick the surface palette. Zinc accents adapt to each.">
                  <div className="flex gap-2.5">
                    {(
                      [
                        ['system', 'System'],
                        ['light', 'Light'],
                        ['dark', 'Dark']
                      ] as Array<[ThemePreference, string]>
                    ).map(([v, l]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setTheme(v)}
                        className={cn(
                          'flex h-12 min-w-[120px] items-center gap-2.5 rounded-lg border px-3.5 font-mono text-xs transition-colors',
                          theme === v
                            ? 'border-primary bg-accent text-foreground'
                            : 'border-border text-muted-foreground hover:border-border-strong'
                        )}
                      >
                        <span
                          className="h-5 w-5 rounded-md border border-border-strong"
                          style={
                            v === 'system'
                              ? {
                                  background: 'linear-gradient(135deg,#fff 0 49%,#18181b 51% 100%)'
                                }
                              : v === 'dark'
                                ? { background: 'linear-gradient(135deg,#09090b,#27272a)' }
                                : { background: 'linear-gradient(135deg,#fff,#e4e4e7)' }
                          }
                        />
                        {l}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            )}
            {section === 'general' && (
              <div className="divide-y divide-border/70">
                {(
                  [
                    ['Restore tabs on launch', true],
                    ['Confirm destructive actions', true],
                    ['Live polling', true],
                    ['Telemetry', false]
                  ] as Array<[string, boolean]>
                ).map(([l, on]) => (
                  <SettingRow key={l} label={l}>
                    <Switch checked={on} onChange={() => {}} />
                  </SettingRow>
                ))}
              </div>
            )}
            {section === 'keymap' && (
              <div className="grid grid-cols-2 gap-x-8">
                {(
                  [
                    ['Command palette', ['⌘', 'K']],
                    ['New tab', ['⌘', 'T']],
                    ['Close tab', ['⌘', 'W']],
                    ['Toggle theme', ['⌘', '⇧', 'L']],
                    ['Run / execute', ['⌘', '⏎']],
                    ['Find', ['⌘', 'F']],
                    ['Next tab', ['⌘', '⌥', '→']],
                    ['Refresh', ['⌘', 'R']]
                  ] as Array<[string, string[]]>
                ).map(([l, ks]) => (
                  <div
                    key={l}
                    className="flex items-center justify-between border-b border-border/70 py-2.5 font-mono text-[12.5px] text-muted-foreground"
                  >
                    <span>{l}</span>
                    <span className="flex gap-1">
                      {ks.map((k, i) => (
                        <Kbd key={i}>{k}</Kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {section === 'about' && (
              <div className="space-y-3 font-mono text-[13px] text-muted-foreground">
                <div className="flex items-center gap-2.5 text-foreground">
                  <span className="h-3 w-3 rotate-45 bg-primary" />
                  <span className="font-semibold">{product}</span>
                </div>
                <p className="max-w-md leading-relaxed text-muted-foreground">
                  A focused Kubernetes desktop client with a zinc palette and JetBrains Mono.
                </p>
                <div className="text-xs text-faint">
                  version 1.0.0 · built on Electron, React, and Tailwind
                </div>
                <div className="mt-5 border-t border-border/70 pt-4">
                  <p className="text-xs text-muted-foreground">
                    A product of{' '}
                    <span className="font-medium text-foreground">Pintle Company Limited</span>
                  </p>
                  <a
                    href="https://www.pintle.app"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Icon name="link" className="h-3.5 w-3.5" />
                    www.pintle.app
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Overlay>
  )
}

function Field({
  title,
  desc,
  children
}: {
  title: string
  desc?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="mb-1 font-mono text-xs font-semibold uppercase tracking-[0.08em] text-foreground">
        {title}
      </h3>
      {desc && (
        <p className="mb-3 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">{desc}</p>
      )}
      {children}
    </div>
  )
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="font-mono text-[12.5px] text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}
