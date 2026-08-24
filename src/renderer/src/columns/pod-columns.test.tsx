import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { flexRender } from '@tanstack/react-table'
import {
  getCoreRowModel,
  useLegacyTable as useReactTable,
  type LegacyColumnDef,
  type LegacyRow as Row
} from '@tanstack/react-table/legacy'
import { podColumns } from './pod-columns'
import type { Pod } from '../types'

function pod(overrides: Partial<Pod> = {}): Pod {
  return {
    name: 'checkout-api-abc',
    ns: 'checkout',
    status: 'Running',
    ready: '1/1',
    restarts: 0,
    cpu: '12m',
    mem: '64Mi',
    node: 'ip-10-2-22-7',
    age: '2m',
    ip: '10.2.22.7',
    containers: [{ name: 'app', ready: true, state: 'Running' }],
    ...overrides
  }
}

/** Renders pod rows through the real column defs — no virtualization (so no
 * ResizeObserver needed), just the cell renderers under test. */
function Cells({ row }: { row: Pod }) {
  const table = useReactTable({
    data: [row],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    columns: podColumns as LegacyColumnDef<Pod, any>[],
    getCoreRowModel: getCoreRowModel()
  })
  const r = table.getRowModel().rows[0] as Row<Pod>
  return (
    <table>
      <tbody>
        <tr>
          {r.getVisibleCells().map((cell) => (
            <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

describe('podColumns status cell', () => {
  it('renders Running with the success tone', () => {
    render(<Cells row={pod({ status: 'Running' })} />)
    expect(screen.getByText('Running')).toHaveClass('text-success')
  })

  it('renders CrashLoopBackOff with the destructive tone', () => {
    render(<Cells row={pod({ status: 'CrashLoopBackOff' })} />)
    expect(screen.getByText('CrashLoopBackOff')).toHaveClass('text-destructive')
  })

  it('falls back to the dim tone for an unknown status', () => {
    render(<Cells row={pod({ status: 'Unknown' })} />)
    expect(screen.getByText('Unknown')).toHaveClass('text-dim')
  })
})

describe('podColumns container cell', () => {
  it('renders one square per container, toned by state', () => {
    render(
      <Cells
        row={pod({
          containers: [
            { name: 'app', ready: true, state: 'Running' },
            { name: 'istio-proxy', ready: false, state: 'CrashLoopBackOff' }
          ]
        })}
      />
    )
    const ready = screen.getByTitle('app · Running · ready')
    const crashing = screen.getByTitle('istio-proxy · CrashLoopBackOff')
    expect(ready).toHaveClass('bg-success')
    expect(crashing).toHaveClass('bg-destructive')
  })
})

describe('podColumns restarts cell', () => {
  it('colours a high restart count as destructive', () => {
    render(<Cells row={pod({ restarts: 7 })} />)
    expect(screen.getByText('7')).toHaveClass('text-destructive')
  })

  it('colours a low restart count as warning', () => {
    render(<Cells row={pod({ restarts: 2 })} />)
    expect(screen.getByText('2')).toHaveClass('text-warning')
  })

  it('colours zero restarts as dim', () => {
    render(<Cells row={pod({ restarts: 0 })} />)
    expect(screen.getByText('0')).toHaveClass('text-dim')
  })
})
