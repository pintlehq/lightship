import { Icon } from '@renderer/ui/components/icon'
import { Kbd } from '@renderer/ui/components/kbd'
import { Tooltip } from '@renderer/ui/components/tooltip'
import { useThemeStore } from '@renderer/ui/stores/theme-store'

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.resolvedTheme)
  const toggle = useThemeStore((s) => s.toggle)
  return (
    <Tooltip label={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
      <button
        type="button"
        onClick={toggle}
        className="no-drag grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="h-[15px] w-[15px]" />
      </button>
    </Tooltip>
  )
}

function HistoryMenu({ onOpen }: { onOpen?: () => void }) {
  return (
    <Tooltip label="History">
      <button
        type="button"
        onClick={onOpen}
        className="no-drag grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      >
        <Icon name="history" className="h-[15px] w-[15px]" />
      </button>
    </Tooltip>
  )
}

export interface TitlebarProps {
  paletteHint: string
  onPalette?: () => void
  onSettings?: () => void
  onHistory?: () => void
}

export function Titlebar({ paletteHint, onPalette, onSettings, onHistory }: TitlebarProps) {
  return (
    <header className="drag grid h-9 select-none grid-cols-[1fr_auto_1fr] items-center border-b border-border bg-chrome px-3">
      {/* Left cell: empty drag area. The real macOS traffic lights (enabled via
          titleBarStyle:'hidden' + trafficLightPosition) float over this space. */}
      <div className="flex items-center gap-3" />

      <button
        type="button"
        onClick={onPalette}
        className="no-drag flex h-6 w-[380px] max-w-[44vw] items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs text-dim transition-colors hover:border-border-strong hover:text-muted-foreground"
      >
        <Icon name="search" className="h-3.5 w-3.5" />
        <span className="truncate">{paletteHint}</span>
        <span className="ml-auto flex items-center gap-1">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="flex items-center justify-end gap-1">
        <HistoryMenu onOpen={onHistory} />
        <ThemeToggle />
        <Tooltip label="Settings">
          <button
            type="button"
            onClick={onSettings}
            className="no-drag grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          >
            <Icon name="settings" className="h-[15px] w-[15px]" />
          </button>
        </Tooltip>
      </div>
    </header>
  )
}
