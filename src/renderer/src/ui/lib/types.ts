import type { CellData, RowData, TableFeatures } from '@tanstack/react-table'
import type { IconName } from '../components/icon'

/** Health / status tones shared across dots, badges, status segments. */
export type Tone = 'success' | 'warning' | 'destructive' | 'info' | 'dim' | 'primary'

/** A workspace tab. `view` is an app-specific descriptor of what to render. */
export interface TabItem<TView = unknown> {
  id: string
  label: string
  icon?: IconName
  iconClass?: string
  dirty?: boolean
  view: TView
}

/** Where a dragged tab should land relative to the hovered target tab. */
export type TabbarReorderPlacement = 'before' | 'after'

/** Command-palette entry. */
export interface PaletteItem {
  label: string
  icon?: IconName
  hint?: string
  kbd?: string[]
  onSelect?: () => void
}
export interface PaletteGroup {
  group: string
  items: PaletteItem[]
}

/** Sidebar action button (top-right of the sidebar header). */
export interface SidebarAction {
  icon: IconName
  label: string
  onClick?: () => void
}

/** Tabbar action button (right of the tab strip). */
export interface TabbarAction {
  icon: IconName
  label: string
  active?: boolean
  onClick?: () => void
}

/** Activity-history entry rendered by the shared HistoryView. */
export interface HistoryItem {
  icon?: IconName
  label: string
  sub?: string
  time: string
  /** Status accent — `destructive` marks a failed action. */
  tone?: Tone
}

declare module '@tanstack/react-table' {
  interface ColumnMeta<
    TFeatures extends TableFeatures,
    TData extends RowData,
    TValue extends CellData = CellData
  > {
    /** Preserves the v9 declaration's feature-aware type parameters. */
    __lightshipTypeParams?: [TFeatures, TData, TValue]
    /** Text alignment applied to both header and body cells. */
    align?: 'left' | 'right' | 'center'
    /** Extra classes merged into every body `<td>` for this column. */
    cellClassName?: string
    /** Extra classes merged into the header `<th>`. */
    headerClassName?: string
    /** Fixed-width utility, e.g. `w-12`. */
    widthClassName?: string
  }
}
