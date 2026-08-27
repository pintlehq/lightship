import * as React from 'react'
import {
  type ColumnOrderState,
  type ColumnSizingState,
  type OnChangeFn,
  type RowData,
  type RowSelectionState,
  type SortingState,
  flexRender
} from '@tanstack/react-table'
import {
  type LegacyColumn as Column,
  type LegacyColumnDef as ColumnDef,
  type LegacyHeader as Header,
  type LegacyRow as Row,
  getCoreRowModel,
  getSortedRowModel,
  useLegacyTable as useReactTable
} from '@tanstack/react-table/legacy'
import { useVirtualizer } from '@tanstack/react-virtual'

import { reorderById } from '@renderer/ui/lib/reorder'
import type { TabbarReorderPlacement } from '@renderer/ui/lib/types'
import { cn } from '@renderer/ui/lib/utils'
// Pull in the ColumnMeta augmentation (align/cellClassName/…).
import '@renderer/ui/lib/types'
import { Checkbox } from './checkbox'
import { ContextMenu, type ContextMenuItemDef } from './context-menu'
import { Icon } from './icon'

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const
const DEFAULT_RESIZABLE_MIN_WIDTH = 48
const UTILITY_COLUMN_IDS = new Set(['#', '__select', '__act', '__actions', 'actions'])

interface ResizeDrag {
  columnId: string
  pointerId: number
  startX: number
  startGuideX: number
  startWidth: number
  minWidth: number
}

interface ColumnDropTarget {
  id: string
  placement: TabbarReorderPlacement
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function columnDefId<TData extends RowData>(column: ColumnDef<TData, any>): string | null {
  if ('id' in column && typeof column.id === 'string') return column.id
  if ('accessorKey' in column && column.accessorKey != null)
    return String(column.accessorKey).replace(/\./g, '_')
  return typeof column.header === 'string' ? column.header : null
}

function leafColumnIds<TData extends RowData>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[],
  prefix = ''
): string[] {
  return columns.flatMap((column, index) => {
    const indexPath = `${prefix}${index}`
    if ('columns' in column && Array.isArray(column.columns))
      return leafColumnIds(column.columns, `${indexPath}.`)
    return columnDefId(column) ?? []
  })
}

function sameItems(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const items = new Set(a)
  return b.every((item) => items.has(item))
}

function isUtilityColumnId(id: string): boolean {
  return UTILITY_COLUMN_IDS.has(id) || id.startsWith('__')
}

/** Imperative handle exposed via `apiRef`. */
export interface DataTableApi {
  /** Scroll a row index into view (no-op when not virtualized). */
  scrollToIndex(index: number): void
}

export interface DataTableProps<TData extends RowData> {
  data: TData[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[]
  getRowId?: (row: TData, index: number) => string
  onRowClick?: (row: TData) => void
  /** Highlights a single row (e.g. the DataGrid's selected record). */
  activeRowId?: string
  rowClassName?: (row: TData) => string | undefined
  /** Right-click a row to open a context menu with these items. */
  rowContextMenu?: (row: TData) => ContextMenuItemDef[]

  /** Prepend a select-all/select-row checkbox column. */
  enableRowSelection?: boolean
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>

  enableSorting?: boolean
  sorting?: SortingState
  onSortingChange?: OnChangeFn<SortingState>
  /** Keep sort state/indicators but don't reorder rows client-side (the data source is already
   *  sorted, e.g. server-side). Also makes `row.index` match the visual row order. */
  manualSorting?: boolean
  /** Populated with imperative helpers (e.g. `scrollToIndex`) for callers that need them. */
  apiRef?: React.MutableRefObject<DataTableApi | null>

  /** Virtualize rows (for large datasets). Needs a bounded `containerClassName`. */
  virtualize?: boolean
  estimateRowHeight?: number
  overscan?: number

  /** Fixed-layout table: single-line (truncated) cells with drag-to-resize columns. */
  resizableColumns?: boolean

  /** `<table>` classes. */
  className?: string
  /** Default `<th>` classes (per-column `meta.headerClassName` is appended). */
  headerCellClassName?: string
  /** Default `<td>` classes (per-column `meta.cellClassName` is appended). */
  cellClassName?: string
  /** Scroll container classes — set a height here when `virtualize` is on. */
  containerClassName?: string
  stickyHeader?: boolean
  /** Rendered as a full-width row when there are no rows (keeps the header visible). */
  emptyState?: React.ReactNode
}

export function DataTable<TData extends RowData>({
  data,
  columns,
  getRowId,
  onRowClick,
  activeRowId,
  rowClassName,
  rowContextMenu,
  enableRowSelection,
  rowSelection,
  onRowSelectionChange,
  enableSorting,
  sorting,
  onSortingChange,
  manualSorting,
  apiRef,
  virtualize,
  estimateRowHeight = 34,
  overscan = 12,
  resizableColumns,
  className,
  headerCellClassName,
  cellClassName,
  containerClassName,
  stickyHeader,
  emptyState
}: DataTableProps<TData>) {
  const allColumns = React.useMemo(() => {
    if (!enableRowSelection) return columns
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const selectionColumn: ColumnDef<TData, any> = {
      id: '__select',
      enableSorting: false,
      enableResizing: false,
      size: 36,
      meta: { widthClassName: 'w-9' },
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllRowsSelected()}
          indeterminate={table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()}
          onChange={(value) => table.toggleAllRowsSelected(value)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox checked={row.getIsSelected()} onChange={(value) => row.toggleSelected(value)} />
      )
    }
    return [selectionColumn, ...columns]
  }, [enableRowSelection, columns])

  const defaultColumnOrder = React.useMemo(() => leafColumnIds(allColumns), [allColumns])
  const defaultColumnOrderKey = defaultColumnOrder.join('\u0000')
  const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>(defaultColumnOrder)
  const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>({})
  const state: {
    rowSelection?: RowSelectionState
    sorting?: SortingState
    columnOrder?: ColumnOrderState
    columnSizing?: ColumnSizingState
  } = {}
  if (rowSelection) state.rowSelection = rowSelection
  if (sorting) state.sorting = sorting
  state.columnOrder = columnOrder
  if (resizableColumns) state.columnSizing = columnSizing

  const table = useReactTable({
    data,
    columns: allColumns,
    getRowId,
    state,
    enableRowSelection,
    enableSorting: !!enableSorting,
    enableColumnResizing: !!resizableColumns,
    columnResizeMode: 'onChange',
    onRowSelectionChange,
    onSortingChange,
    onColumnOrderChange: setColumnOrder,
    onColumnSizingChange: setColumnSizing,
    manualSorting: !!manualSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: enableSorting && !manualSorting ? getSortedRowModel() : undefined
  })

  const rows = table.getRowModel().rows
  const colCount = table.getVisibleLeafColumns().length
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const resizeDragRef = React.useRef<ResizeDrag | null>(null)
  const draggedColumnId = React.useRef<string | null>(null)
  const suppressHeaderClick = React.useRef(false)
  const [emptyViewportWidth, setEmptyViewportWidth] = React.useState<number | null>(null)
  const [resizeGuideX, setResizeGuideX] = React.useState<number | null>(null)
  const [draggingColumnId, setDraggingColumnId] = React.useState<string | null>(null)
  const [columnDropTarget, setColumnDropTarget] = React.useState<ColumnDropTarget | null>(null)
  const shouldMeasureEmptyViewport = !!resizableColumns && !!emptyState

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan,
    enabled: !!virtualize
  })

  React.useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      scrollToIndex: (index: number) => {
        if (virtualize) virtualizer.scrollToIndex(index)
      }
    }
    return () => {
      apiRef.current = null
    }
  }, [apiRef, virtualize, virtualizer])

  React.useLayoutEffect(() => {
    if (!shouldMeasureEmptyViewport) return
    const el = scrollRef.current
    if (!el) return

    const updateWidth = () => setEmptyViewportWidth(el.clientWidth)
    updateWidth()

    const observer = new ResizeObserver(updateWidth)
    observer.observe(el)
    return () => observer.disconnect()
  }, [shouldMeasureEmptyViewport])

  React.useEffect(() => {
    setColumnOrder((order) => (sameItems(order, defaultColumnOrder) ? order : defaultColumnOrder))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultColumnOrderKey])

  const virtualItems = virtualize ? virtualizer.getVirtualItems() : []
  const paddingTop = virtualItems.length ? virtualItems[0].start : 0
  const paddingBottom = virtualItems.length
    ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
    : 0
  const guideX = resizeGuideX

  const resizableMinWidth = React.useCallback((header: Header<TData, unknown>) => {
    const size = header.column.columnDef.size
    if (typeof size === 'number' && size > 0 && size < DEFAULT_RESIZABLE_MIN_WIDTH) return size
    return DEFAULT_RESIZABLE_MIN_WIDTH
  }, [])

  const columnWidthStyle = React.useCallback(
    (width: number): React.CSSProperties => ({
      width,
      minWidth: 0,
      maxWidth: width
    }),
    []
  )

  const handleResizePointerDown = React.useCallback(
    (header: Header<TData, unknown>, e: React.PointerEvent<HTMLSpanElement>) => {
      if (!resizableColumns) return
      e.preventDefault()
      e.stopPropagation()

      const el = scrollRef.current
      if (!el) return

      const rect = el.getBoundingClientRect()
      const drag: ResizeDrag = {
        columnId: header.column.id,
        pointerId: e.pointerId,
        startX: e.clientX,
        startGuideX: e.clientX - rect.left + el.scrollLeft,
        startWidth: header.getSize(),
        minWidth: resizableMinWidth(header)
      }
      resizeDragRef.current = drag
      e.currentTarget.setPointerCapture(e.pointerId)
      setResizeGuideX(drag.startGuideX)
    },
    [resizableColumns, resizableMinWidth]
  )

  const handleResizePointerMove = React.useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    const drag = resizeDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.preventDefault()
    e.stopPropagation()

    const nextWidth = Math.max(drag.minWidth, Math.round(drag.startWidth + e.clientX - drag.startX))
    setColumnSizing((sizing) => ({ ...sizing, [drag.columnId]: nextWidth }))
    setResizeGuideX(drag.startGuideX + nextWidth - drag.startWidth)
  }, [])

  const handleResizePointerEnd = React.useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    const drag = resizeDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.preventDefault()
    e.stopPropagation()
    resizeDragRef.current = null
    setResizeGuideX(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  const handleResizeClick = React.useCallback((e: React.MouseEvent<HTMLSpanElement>) => {
    if (resizeDragRef.current) e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleSortButtonClick = React.useCallback(
    (header: Header<TData, unknown>) => (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation()
      if (resizeDragRef.current || suppressHeaderClick.current) {
        e.preventDefault()
        suppressHeaderClick.current = false
        return
      }
      header.column.getToggleSortingHandler()?.(e)
    },
    []
  )

  const handleResizeMouseDown = React.useCallback((e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation()
  }, [])

  const handleResizeTouchStart = React.useCallback((e: React.TouchEvent<HTMLSpanElement>) => {
    e.stopPropagation()
  }, [])

  const resetResizeDrag = React.useCallback(() => {
    resizeDragRef.current = null
    setResizeGuideX(null)
  }, [])

  React.useEffect(() => {
    if (!resizableColumns) resetResizeDrag()
  }, [resizableColumns, resetResizeDrag])

  React.useEffect(() => {
    return () => resetResizeDrag()
  }, [resetResizeDrag])

  const resizeHandleKeyDown = React.useCallback(
    (header: Header<TData, unknown>, e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      e.stopPropagation()
      const delta = e.key === 'ArrowRight' ? 16 : -16
      const minWidth = resizableMinWidth(header)
      setColumnSizing((sizing) => ({
        ...sizing,
        [header.column.id]: Math.max(minWidth, header.getSize() + delta)
      }))
    },
    [resizableMinWidth]
  )

  const isMovableColumn = React.useCallback(
    (column: Column<TData, unknown>) =>
      column.columnDef.enableResizing !== false && !isUtilityColumnId(column.id),
    []
  )
  const movableColumnCount = table.getVisibleLeafColumns().filter(isMovableColumn).length
  const reorderEnabled = movableColumnCount > 1

  const columnDropPlacement = React.useCallback(
    (e: React.DragEvent<HTMLElement>): TabbarReorderPlacement => {
      const target = e.currentTarget.closest('th') ?? e.currentTarget
      const rect = target.getBoundingClientRect()
      return e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
    },
    []
  )

  const clearColumnDragState = React.useCallback(() => {
    draggedColumnId.current = null
    setDraggingColumnId(null)
    setColumnDropTarget(null)
  }, [])

  const finishColumnDrag = React.useCallback(() => {
    clearColumnDragState()
    window.setTimeout(() => {
      suppressHeaderClick.current = false
    }, 0)
  }, [clearColumnDragState])

  const moveColumn = React.useCallback(
    (sourceId: string, targetId: string, placement: TabbarReorderPlacement) => {
      const visibleColumns = table.getVisibleLeafColumns()
      const movableIds = visibleColumns.filter(isMovableColumn).map((column) => column.id)
      if (!movableIds.includes(sourceId) || !movableIds.includes(targetId)) return

      const reorderedMovableIds = reorderById(
        movableIds.map((id) => ({ id })),
        sourceId,
        targetId,
        placement
      ).map((item) => item.id)
      let movableIndex = 0
      const nextOrder = visibleColumns.map((column) =>
        isMovableColumn(column) ? reorderedMovableIds[movableIndex++] : column.id
      )
      setColumnOrder((order) => {
        const remaining = order.filter((id) => !nextOrder.includes(id))
        return [...nextOrder, ...remaining]
      })
    },
    [isMovableColumn, table]
  )

  const handleColumnDragStart = React.useCallback(
    (header: Header<TData, unknown>, e: React.DragEvent<HTMLElement>) => {
      if (!reorderEnabled || !isMovableColumn(header.column)) return
      if ((e.target as Element | null)?.closest('[data-table-header-control="true"]')) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      draggedColumnId.current = header.column.id
      suppressHeaderClick.current = true
      setDraggingColumnId(header.column.id)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', header.column.id)
    },
    [isMovableColumn, reorderEnabled]
  )

  const handleColumnDragOver = React.useCallback(
    (header: Header<TData, unknown>, e: React.DragEvent<HTMLElement>) => {
      const sourceId = draggedColumnId.current
      if (
        !reorderEnabled ||
        !sourceId ||
        sourceId === header.column.id ||
        !isMovableColumn(header.column)
      )
        return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      const placement = columnDropPlacement(e)
      setColumnDropTarget((current) =>
        current?.id === header.column.id && current.placement === placement
          ? current
          : { id: header.column.id, placement }
      )
    },
    [columnDropPlacement, isMovableColumn, reorderEnabled]
  )

  const handleColumnDragLeave = React.useCallback(
    (header: Header<TData, unknown>, e: React.DragEvent<HTMLElement>) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setColumnDropTarget((current) => (current?.id === header.column.id ? null : current))
    },
    []
  )

  const handleColumnDrop = React.useCallback(
    (header: Header<TData, unknown>, e: React.DragEvent<HTMLElement>) => {
      const sourceId = draggedColumnId.current
      if (
        !reorderEnabled ||
        !sourceId ||
        sourceId === header.column.id ||
        !isMovableColumn(header.column)
      )
        return
      e.preventDefault()
      e.stopPropagation()
      const placement =
        columnDropTarget?.id === header.column.id
          ? columnDropTarget.placement
          : columnDropPlacement(e)
      moveColumn(sourceId, header.column.id, placement)
      finishColumnDrag()
    },
    [
      columnDropPlacement,
      columnDropTarget,
      finishColumnDrag,
      isMovableColumn,
      moveColumn,
      reorderEnabled
    ]
  )

  const renderRow = (row: Row<TData>) => {
    const selected = row.getIsSelected()
    const isActive = activeRowId != null && row.id === activeRowId
    const tr = (
      <tr
        key={row.id}
        onClick={onRowClick ? () => onRowClick(row.original) : undefined}
        className={cn(
          'transition-colors',
          onRowClick && 'cursor-pointer',
          isActive || selected ? 'bg-active' : 'hover:bg-hover',
          rowClassName?.(row.original)
        )}
      >
        {row.getVisibleCells().map((cell) => {
          const meta = cell.column.columnDef.meta
          // The selection checkbox must toggle without triggering row navigation.
          const isSelect = cell.column.id === '__select'
          return (
            <td
              key={cell.id}
              onClick={isSelect ? (e) => e.stopPropagation() : undefined}
              style={resizableColumns ? columnWidthStyle(cell.column.getSize()) : undefined}
              className={cn(
                cellClassName,
                meta?.align && ALIGN[meta.align],
                resizableColumns ? 'truncate' : meta?.widthClassName,
                meta?.cellClassName
              )}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </td>
          )
        })}
      </tr>
    )
    if (rowContextMenu) {
      return (
        <ContextMenu key={row.id} items={rowContextMenu(row.original)}>
          {tr}
        </ContextMenu>
      )
    }
    return tr
  }

  return (
    <div ref={scrollRef} className={cn('relative overflow-auto', containerClassName)}>
      {resizableColumns && guideX != null && (
        <div
          data-testid="data-table-column-resize-guide"
          className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-primary"
          style={{ left: guideX }}
        />
      )}
      <table
        style={
          resizableColumns
            ? { width: table.getTotalSize(), minWidth: table.getTotalSize() }
            : undefined
        }
        className={cn('border-collapse', resizableColumns ? 'table-fixed' : 'w-full', className)}
      >
        {resizableColumns && (
          <colgroup>
            {table.getVisibleLeafColumns().map((column) => (
              <col key={column.id} style={columnWidthStyle(column.getSize())} />
            ))}
          </colgroup>
        )}
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const meta = header.column.columnDef.meta
                const canSort = !!enableSorting && header.column.getCanSort()
                const sortDir = header.column.getIsSorted()
                const canResize = !!resizableColumns && header.column.getCanResize()
                const canReorder = reorderEnabled && isMovableColumn(header.column)
                return (
                  <th
                    key={header.id}
                    aria-sort={
                      canSort
                        ? sortDir === 'asc'
                          ? 'ascending'
                          : sortDir === 'desc'
                            ? 'descending'
                            : 'none'
                        : undefined
                    }
                    data-testid={canReorder ? `data-table-reorder-${header.column.id}` : undefined}
                    draggable={canReorder}
                    onDragStart={canReorder ? (e) => handleColumnDragStart(header, e) : undefined}
                    onDragOver={canReorder ? (e) => handleColumnDragOver(header, e) : undefined}
                    onDragLeave={canReorder ? (e) => handleColumnDragLeave(header, e) : undefined}
                    onDrop={canReorder ? (e) => handleColumnDrop(header, e) : undefined}
                    onDragEnd={canReorder ? () => finishColumnDrag() : undefined}
                    style={resizableColumns ? columnWidthStyle(header.getSize()) : undefined}
                    className={cn(
                      headerCellClassName,
                      meta?.align && ALIGN[meta.align],
                      !resizableColumns && meta?.widthClassName,
                      // `relative` gives drag markers/resize handles a containing block;
                      // a sticky header is already positioned, so only add it when needed.
                      (canResize || canReorder) && !stickyHeader && 'relative',
                      meta?.headerClassName,
                      resizableColumns && 'min-w-0',
                      stickyHeader && 'sticky top-0 z-10',
                      canReorder && 'cursor-grab select-none active:cursor-grabbing'
                    )}
                  >
                    {columnDropTarget?.id === header.column.id && (
                      <span
                        data-testid="data-table-column-drop-marker"
                        className={cn(
                          'pointer-events-none absolute inset-y-1 z-20 w-[2px] rounded-full bg-primary',
                          columnDropTarget.placement === 'before' ? 'left-0' : 'right-0'
                        )}
                      />
                    )}
                    <span
                      className={cn(
                        'flex w-full min-w-0 items-center gap-1.5',
                        draggingColumnId === header.column.id && 'opacity-45',
                        meta?.align === 'center' && 'justify-center'
                      )}
                    >
                      <span
                        className={cn(
                          'min-w-0 flex-1 overflow-hidden',
                          meta?.align === 'right' && 'text-right'
                        )}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </span>
                      {canSort && (
                        <button
                          type="button"
                          aria-label={`Sort ${header.column.id} column`}
                          data-table-header-control="true"
                          data-testid={`data-table-sort-${header.column.id}`}
                          draggable={false}
                          onClick={handleSortButtonClick(header)}
                          onDragStart={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          className={cn(
                            'inline-grid h-5 w-5 shrink-0 place-items-center rounded text-faint transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
                            sortDir && 'text-muted-foreground'
                          )}
                        >
                          <Icon
                            name={sortDir ? 'arrowDown' : 'chevronsUpDown'}
                            className={cn('h-3 w-3', sortDir === 'asc' && 'rotate-180')}
                          />
                        </button>
                      )}
                    </span>
                    {canResize && (
                      <span
                        role="separator"
                        aria-label={`Resize ${header.column.id} column`}
                        aria-orientation="vertical"
                        aria-valuemin={resizableMinWidth(header)}
                        aria-valuenow={Math.round(header.getSize())}
                        data-table-header-control="true"
                        data-testid={`data-table-resize-${header.column.id}`}
                        data-column-id={header.column.id}
                        tabIndex={0}
                        onPointerDown={(e) => handleResizePointerDown(header, e)}
                        onPointerMove={handleResizePointerMove}
                        onPointerUp={handleResizePointerEnd}
                        onPointerCancel={handleResizePointerEnd}
                        onLostPointerCapture={resetResizeDrag}
                        onMouseDown={handleResizeMouseDown}
                        onTouchStart={handleResizeTouchStart}
                        onClick={handleResizeClick}
                        onKeyDown={(e) => resizeHandleKeyDown(header, e)}
                        className="group absolute right-0 top-0 z-20 block h-full w-3 cursor-col-resize touch-none select-none"
                      >
                        <span
                          className={cn(
                            'pointer-events-none absolute inset-y-0 right-0 w-px',
                            resizeDragRef.current?.columnId === header.column.id
                              ? 'bg-primary opacity-100'
                              : 'bg-border-strong opacity-0 group-hover:opacity-100'
                          )}
                        />
                      </span>
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.length === 0 && emptyState ? (
            <tr>
              <td colSpan={colCount} className="p-0">
                {resizableColumns ? (
                  <div
                    data-testid="data-table-empty-viewport"
                    className="sticky left-0"
                    style={emptyViewportWidth != null ? { width: emptyViewportWidth } : undefined}
                  >
                    {emptyState}
                  </div>
                ) : (
                  emptyState
                )}
              </td>
            </tr>
          ) : virtualize ? (
            <>
              {paddingTop > 0 && (
                <tr aria-hidden>
                  <td colSpan={colCount} style={{ height: paddingTop, padding: 0, border: 0 }} />
                </tr>
              )}
              {virtualItems.map((vi) => renderRow(rows[vi.index]))}
              {paddingBottom > 0 && (
                <tr aria-hidden>
                  <td colSpan={colCount} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                </tr>
              )}
            </>
          ) : (
            rows.map(renderRow)
          )}
        </tbody>
      </table>
    </div>
  )
}
