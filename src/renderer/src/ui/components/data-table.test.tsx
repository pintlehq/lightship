import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SortingState } from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'

import { DataTable } from './data-table'

interface Row {
  id: string
  name: string
  email: string
  role: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const columns: ColumnDef<Row, any>[] = [
  { accessorKey: 'id', header: 'ID', size: 320 },
  { accessorKey: 'name', header: 'Name', size: 320 },
  { accessorKey: 'email', header: 'Email', size: 320 },
  { accessorKey: 'role', header: 'Role', size: 320 }
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const utilityColumns: ColumnDef<Row, any>[] = [
  { id: '#', header: '#', size: 56, enableResizing: false, cell: (c) => c.row.index + 1 },
  { accessorKey: 'id', header: 'ID', size: 320 },
  { accessorKey: 'name', header: 'Name', size: 320 },
  { accessorKey: 'email', header: 'Email', size: 320 }
]

function dataTransfer() {
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn(),
    getData: vi.fn()
  }
}

function headerTexts(): string[] {
  return screen.getAllByRole('columnheader').map((header) => header.textContent?.trim() ?? '')
}

function firstRowCellTexts(table: HTMLElement): string[] {
  return Array.from(table.querySelectorAll('tbody tr:first-child td')).map(
    (cell) => cell.textContent?.trim() ?? ''
  )
}

function SortableTable() {
  const [sorting, setSorting] = useState<SortingState>([])
  return (
    <DataTable
      data={[
        { id: '2', name: 'Bea', email: 'bea@x.io', role: 'user' },
        { id: '1', name: 'Ada', email: 'ada@x.io', role: 'admin' }
      ]}
      columns={columns}
      enableSorting
      sorting={sorting}
      onSortingChange={setSorting}
    />
  )
}

describe('DataTable', () => {
  it('allocates enough width for selection checkboxes and cell padding', () => {
    render(
      <DataTable
        data={[{ id: '1', name: 'Ada', email: 'ada@x.io', role: 'admin' }]}
        columns={columns}
        enableRowSelection
        resizableColumns
        rowSelection={{}}
        onRowSelectionChange={vi.fn()}
      />
    )

    const selectionCol = screen.getByRole('table').querySelector('col')
    expect(selectionCol).toHaveStyle({ width: '36px' })
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('keeps the empty state centered within the visible viewport for resizable columns', () => {
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(480)

    render(
      <DataTable data={[]} columns={columns} resizableColumns emptyState={<div>No rows</div>} />
    )

    const emptyCell = screen.getByText('No rows').closest('td')
    expect(emptyCell).toHaveAttribute('colspan', String(columns.length))

    const table = screen.getByRole('table')
    expect(table).toHaveStyle({ width: '1280px' })

    const viewport = screen.getByTestId('data-table-empty-viewport')
    expect(viewport).toHaveClass('sticky', 'left-0')
    expect(viewport).toHaveStyle({ width: '480px' })

    clientWidth.mockRestore()
  })

  it('exposes stable resize handles and col sizing for resizable columns', () => {
    render(
      <DataTable
        data={[{ id: '1', name: 'Ada', email: 'ada@x.io', role: 'admin' }]}
        columns={columns}
        resizableColumns
        headerCellClassName="min-w-[120px]"
      />
    )

    const table = screen.getByRole('table')
    expect(table.querySelectorAll('col')).toHaveLength(columns.length)

    const nameHandle = screen.getByRole('separator', { name: 'Resize name column' })
    expect(nameHandle).toHaveAttribute('data-testid', 'data-table-resize-name')
    expect(nameHandle).toHaveClass('w-3', 'cursor-col-resize')
    expect(nameHandle).not.toHaveAttribute('draggable', 'true')
    expect(screen.getByTestId('data-table-reorder-name')).toHaveAttribute('draggable', 'true')

    const nameHeader = nameHandle.closest('th')
    expect(nameHeader).toHaveClass('min-w-0')
    expect(nameHeader).not.toHaveClass('min-w-[120px]')
  })

  it('reorders movable columns while fixed utility columns stay in place', async () => {
    render(
      <DataTable
        data={[{ id: '1', name: 'Ada', email: 'ada@x.io', role: 'admin' }]}
        columns={utilityColumns}
        resizableColumns
      />
    )

    const table = screen.getByRole('table')
    const transfer = dataTransfer()
    const source = screen.getByTestId('data-table-reorder-id')
    const target = screen.getByTestId('data-table-reorder-name')

    fireEvent.dragStart(source, { dataTransfer: transfer })
    fireEvent.dragOver(target, { dataTransfer: transfer })
    expect(screen.getByTestId('data-table-column-drop-marker')).toBeInTheDocument()
    fireEvent.drop(target, { dataTransfer: transfer })

    await waitFor(() => expect(headerTexts()).toEqual(['#', 'Name', 'ID', 'Email']))
    expect(firstRowCellTexts(table)).toEqual(['1', 'Ada', '1', 'ada@x.io'])
  })

  it('sorts from the end button while header body stays a reorder drag surface', async () => {
    render(<SortableTable />)

    const table = screen.getByRole('table')
    const idHeader = screen.getByTestId('data-table-reorder-id')
    const idSort = screen.getByTestId('data-table-sort-id')

    expect(idHeader.tagName).toBe('TH')
    expect(idHeader).toHaveAttribute('draggable', 'true')
    expect(idSort).not.toHaveAttribute('draggable', 'true')
    expect(firstRowCellTexts(table)[0]).toBe('2')

    fireEvent.click(idHeader)
    expect(firstRowCellTexts(table)[0]).toBe('2')

    fireEvent.click(idSort)

    await waitFor(() => expect(firstRowCellTexts(table)[0]).toBe('1'))
  })

  it('updates column sizing directly from pointer drag', () => {
    const pointerCapture = {
      set: HTMLElement.prototype.setPointerCapture,
      release: HTMLElement.prototype.releasePointerCapture,
      has: HTMLElement.prototype.hasPointerCapture
    }
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn()
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn()
    })
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: () => true
    })

    render(
      <DataTable
        data={[{ id: '1', name: 'Ada', email: 'ada@x.io', role: 'admin' }]}
        columns={columns}
        resizableColumns
      />
    )

    const table = screen.getByRole('table')
    const nameCol = table.querySelectorAll('col')[1]
    const nameHandle = screen.getByRole('separator', { name: 'Resize name column' })

    expect(nameCol).toHaveStyle({ width: '320px' })

    fireEvent.pointerDown(nameHandle, { pointerId: 1, clientX: 320 })
    fireEvent.pointerMove(nameHandle, { pointerId: 1, clientX: 390 })

    expect(nameCol).toHaveStyle({ width: '390px' })
    expect(screen.getByTestId('data-table-column-resize-guide')).toHaveStyle({ left: '390px' })

    fireEvent.pointerUp(nameHandle, { pointerId: 1, clientX: 390 })
    expect(screen.queryByTestId('data-table-column-resize-guide')).not.toBeInTheDocument()

    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: pointerCapture.set
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: pointerCapture.release
    })
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: pointerCapture.has
    })
  })
})
