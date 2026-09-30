import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OnChangeFn, RowSelectionState, SortingState } from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'

import { DataTable, type DataTableProps } from './data-table'
import { durationValue } from '../lib/table-sorting'

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

const sortRows = [
  { id: '2', name: 'Bea', email: 'bea@x.io', role: 'user' },
  { id: '1', name: 'Ada', email: 'ada@x.io', role: 'admin' }
]

function SortableTable({ data = sortRows, ...props }: Partial<DataTableProps<Row>>) {
  const [sorting, setSorting] = useState<SortingState>([])
  return (
    <DataTable
      data={data}
      columns={columns}
      getRowId={(row) => row.id}
      enableSorting
      sorting={sorting}
      onSortingChange={setSorting}
      {...props}
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

  it('cycles ascending, descending and source order from the header and arrow button', () => {
    render(<SortableTable />)

    const table = screen.getByRole('table')
    const idHeader = screen.getByTestId('data-table-reorder-id')
    const idSort = screen.getByTestId('data-table-sort-id')

    expect(idHeader.tagName).toBe('TH')
    expect(idHeader).toHaveAttribute('draggable', 'true')
    expect(idSort).not.toHaveAttribute('draggable', 'true')
    expect(firstRowCellTexts(table)[0]).toBe('2')

    fireEvent.click(idHeader)
    expect(firstRowCellTexts(table)[0]).toBe('1')
    expect(idHeader).toHaveAttribute('aria-sort', 'ascending')

    fireEvent.click(idSort)
    expect(firstRowCellTexts(table)[0]).toBe('2')
    expect(idHeader).toHaveAttribute('aria-sort', 'descending')

    fireEvent.click(screen.getByText('ID'))
    expect(firstRowCellTexts(table)[0]).toBe('2')
    expect(idHeader).toHaveAttribute('aria-sort', 'none')
  })

  it('starts a different column ascending even with Shift pressed', async () => {
    const user = userEvent.setup()
    render(<SortableTable />)
    await user.click(screen.getByText('ID'))
    await user.click(screen.getByText('ID'))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText('Name'))
    await user.keyboard('{/Shift}')
    expect(screen.getByText('ID').closest('th')).toHaveAttribute('aria-sort', 'none')
    expect(screen.getByText('Name').closest('th')).toHaveAttribute('aria-sort', 'ascending')
    expect(firstRowCellTexts(screen.getByRole('table'))[1]).toBe('Ada')
  })

  it('supports keyboard sorting, uncontrolled state and manual sorting', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<DataTable data={sortRows} columns={columns} enableSorting />)
    const button = screen.getByRole('button', { name: 'Sort name column' })
    button.focus()
    await user.keyboard('{Enter}')
    expect(firstRowCellTexts(screen.getByRole('table'))[1]).toBe('Ada')
    await user.keyboard(' ')
    expect(button.closest('th')).toHaveAttribute('aria-sort', 'descending')

    rerender(<SortableTable manualSorting />)
    await user.click(screen.getByText('Name'))
    expect(screen.getByText('Name').closest('th')).toHaveAttribute('aria-sort', 'ascending')
    expect(firstRowCellTexts(screen.getByRole('table'))[1]).toBe('Bea')
  })

  it('keeps sorting through empty results and data updates without mutating the source', () => {
    const { rerender } = render(<SortableTable />)
    fireEvent.click(screen.getByText('Name'))
    rerender(<SortableTable data={[]} />)
    rerender(<SortableTable data={[...sortRows, { ...sortRows[0], id: '3', name: 'Aaron' }]} />)
    expect(firstRowCellTexts(screen.getByRole('table'))[1]).toBe('Aaron')
    expect(sortRows.map((row) => row.id)).toEqual(['2', '1'])
    fireEvent.click(screen.getByText('Name'))
    fireEvent.click(screen.getByText('Name'))
    expect(firstRowCellTexts(screen.getByRole('table'))[1]).toBe('Bea')
  })

  it('keeps missing values last in both directions and equal values in source order', () => {
    render(
      <SortableTable
        data={[
          { ...sortRows[0], id: 'missing', email: '—' },
          { ...sortRows[0], id: 'day', email: '1d' },
          { ...sortRows[0], id: 'hour', email: '2h' },
          { ...sortRows[0], id: 'equal', email: '120m' }
        ]}
        columns={columns.map((column) =>
          'accessorKey' in column && column.accessorKey === 'email'
            ? { ...column, meta: { sortValue: (row: Row) => durationValue(row.email) } }
            : column
        )}
      />
    )
    const ids = () =>
      Array.from(screen.getByRole('table').querySelectorAll('tbody tr')).map(
        (row) => row.querySelector('td')?.textContent
      )
    fireEvent.click(screen.getByText('Email'))
    expect(ids()).toEqual(['hour', 'equal', 'day', 'missing'])
    fireEvent.click(screen.getByText('Email'))
    expect(ids()).toEqual(['day', 'hour', 'equal', 'missing'])
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('retains resource identity when selecting and opening sorted rows', () => {
    const select = vi.fn<OnChangeFn<RowSelectionState>>()
    const open = vi.fn()
    render(<SortableTable enableRowSelection onRowSelectionChange={select} onRowClick={open} />)
    fireEvent.click(screen.getByText('Name'))
    const first = screen.getByRole('table').querySelector('tbody tr')
    expect(first).not.toBeNull()
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(open).not.toHaveBeenCalled()
    const update = select.mock.calls[0][0]
    expect(typeof update === 'function' ? update({}) : update).toEqual({ '1': true })
    fireEvent.click(screen.getByText('Ada'))
    expect(open).toHaveBeenCalledWith(sortRows[1])
    expect(screen.getAllByRole('columnheader')[0]).not.toHaveAttribute('aria-sort')
  })

  it('does not sort disabled columns', () => {
    render(
      <SortableTable columns={columns.map((column) => ({ ...column, enableSorting: false }))} />
    )
    fireEvent.click(screen.getByText('Name'))
    expect(screen.queryByRole('button', { name: 'Sort name column' })).not.toBeInTheDocument()
    expect(firstRowCellTexts(screen.getByRole('table'))[1]).toBe('Bea')
  })

  it('does not sort on a column drag, drop, or resize-handle click', () => {
    render(<SortableTable resizableColumns />)
    const transfer = dataTransfer()
    const source = screen.getByTestId('data-table-reorder-id')
    const target = screen.getByTestId('data-table-reorder-name')
    fireEvent.dragStart(source, { dataTransfer: transfer })
    fireEvent.dragOver(target, { dataTransfer: transfer })
    fireEvent.drop(target, { dataTransfer: transfer })
    fireEvent.dragEnd(source, { dataTransfer: transfer })
    fireEvent.click(source)
    expect(source).toHaveAttribute('aria-sort', 'none')
    fireEvent.click(screen.getByRole('separator', { name: 'Resize name column' }))
    expect(target).toHaveAttribute('aria-sort', 'none')
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
