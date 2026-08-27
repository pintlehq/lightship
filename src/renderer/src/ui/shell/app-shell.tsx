import * as React from 'react'

import { cn } from '@renderer/ui/lib/utils'
import type { TabbarAction, TabbarReorderPlacement } from '@renderer/ui/lib/types'
import { Titlebar } from './titlebar'
import { Tabbar, type TabbarTab } from './tabbar'
import { Statusbar } from './statusbar'

export interface AppShellProps {
  paletteHint: string
  onPalette?: () => void
  onSettings?: () => void
  onHistory?: () => void

  sidebar: React.ReactNode
  children: React.ReactNode
  bottomPanel?: React.ReactNode

  tabs: TabbarTab[]
  activeTab: string | null
  onSelectTab: (id: string) => void
  onCloseTab?: (id: string) => void
  onCloseOtherTabs?: (id: string) => void
  onCloseTabsToRight?: (id: string) => void
  onCloseAllTabs?: () => void
  onReorderTab?: (draggedId: string, targetId: string, placement: TabbarReorderPlacement) => void
  onNewTab?: () => void
  tabbarActions?: TabbarAction[]

  statusLeft?: React.ReactNode
  statusRight?: React.ReactNode

  overlays?: React.ReactNode
}

/**
 * Full window chrome shared by every lightship app: titlebar · sidebar · tabbed
 * main (+ optional bottom panel) · statusbar · overlays. Apps supply their own
 * sidebar, view content, statusbar segments, palette and modals via props.
 */
export function AppShell({
  paletteHint,
  onPalette,
  onSettings,
  onHistory,
  sidebar,
  children,
  bottomPanel,
  tabs,
  activeTab,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onCloseAllTabs,
  onReorderTab,
  onNewTab,
  tabbarActions,
  statusLeft,
  statusRight,
  overlays
}: AppShellProps) {
  return (
    <div className="grid h-screen w-screen grid-rows-[36px_1fr_24px] bg-background">
      <Titlebar
        paletteHint={paletteHint}
        onPalette={onPalette}
        onSettings={onSettings}
        onHistory={onHistory}
      />

      <div className="grid min-h-0 grid-cols-[auto_1fr] overflow-hidden">
        {sidebar}
        <main
          className={cn(
            'grid min-h-0 min-w-0 bg-background',
            bottomPanel ? 'grid-rows-[36px_1fr_auto]' : 'grid-rows-[36px_1fr]'
          )}
        >
          <Tabbar
            tabs={tabs}
            activeId={activeTab}
            onSelect={onSelectTab}
            onClose={onCloseTab}
            onCloseOthers={onCloseOtherTabs}
            onCloseToRight={onCloseTabsToRight}
            onCloseAll={onCloseAllTabs}
            onReorder={onReorderTab}
            onNew={onNewTab}
            actions={tabbarActions}
          />
          <div className="relative min-h-0 overflow-auto">{children}</div>
          {bottomPanel}
        </main>
      </div>

      <Statusbar left={statusLeft} right={statusRight} />
      {overlays}
    </div>
  )
}
