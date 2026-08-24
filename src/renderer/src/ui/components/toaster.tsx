import { Toast } from '@base-ui/react/toast'

import { cn } from '@renderer/ui/lib/utils'
import { Icon, type IconName } from './icon'

/** App-wide toast manager. `toast.*` works from anywhere — components, mutation
 *  handlers, even non-React code (stores) — because it's a singleton manager. */
export const toastManager = Toast.createToastManager()

type ToastKind = 'success' | 'error' | 'info'

function add(type: ToastKind, title: string, description?: string): void {
  toastManager.add({
    title,
    description,
    type,
    timeout: type === 'error' ? 8000 : 4000,
    priority: type === 'error' ? 'high' : 'low'
  })
}

export const toast = {
  success: (title: string, description?: string) => add('success', title, description),
  error: (title: string, description?: string) => add('error', title, description),
  info: (title: string, description?: string) => add('info', title, description)
}

const TONE: Record<string, { icon: IconName; cls: string }> = {
  success: { icon: 'check', cls: 'text-success' },
  error: { icon: 'x', cls: 'text-destructive' },
  info: { icon: 'bell', cls: 'text-primary' }
}

function ToastList() {
  const { toasts } = Toast.useToastManager()
  return toasts.map((t) => {
    const tone = TONE[t.type ?? 'info'] ?? TONE.info
    return (
      <Toast.Root
        key={t.id}
        toast={t}
        className={cn(
          'mb-2 w-[320px] rounded-lg border border-border-strong bg-popover p-3 shadow-lg outline-none',
          'animate-pop-in'
        )}
      >
        <div className="flex items-start gap-2.5">
          <Icon name={tone.icon} className={cn('mt-0.5 h-4 w-4 shrink-0', tone.cls)} />
          <div className="min-w-0 flex-1">
            <Toast.Title className="font-mono text-[12.5px] font-medium text-foreground">
              {t.title}
            </Toast.Title>
            {t.description && (
              <Toast.Description className="mt-0.5 break-words font-mono text-2xs text-dim">
                {t.description}
              </Toast.Description>
            )}
          </div>
          <Toast.Close
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 text-faint outline-none transition-colors hover:bg-hover hover:text-foreground"
          >
            <Icon name="x" className="h-3.5 w-3.5" />
          </Toast.Close>
        </div>
      </Toast.Root>
    )
  })
}

/** Global toast viewport — mount once (e.g. in the AppShell `overlays` slot). */
export function Toaster() {
  return (
    <Toast.Provider toastManager={toastManager}>
      <Toast.Viewport className="fixed bottom-4 right-4 z-[200] flex w-[320px] flex-col outline-none">
        <ToastList />
      </Toast.Viewport>
    </Toast.Provider>
  )
}
