import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { LogLine, ResourceRef } from '../../../shared/ipc-types'
import { LogsPane } from './logs-pane'

const mocks = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
  usePodLogs: vi.fn()
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 24,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 24,
        end: (index + 1) * 24,
        size: 24
      })),
    measureElement: vi.fn(),
    scrollToIndex: mocks.scrollToIndex
  })
}))

vi.mock('@renderer/ui/components/multi-select', () => ({
  MultiSelect: ({
    label,
    selected,
    onChange
  }: {
    label: string
    selected: string[]
    onChange: (next: string[]) => void
  }) => (
    <button type="button" onClick={() => onChange(label === 'Pods' ? ['api-2'] : selected)}>
      {label}: {selected.join(',') || 'all'}
    </button>
  )
}))

vi.mock('../lib/use-pod-logs', () => ({
  usePodLogs: mocks.usePodLogs
}))

const lines: LogLine[] = [
  { pod: 'api-1', container: 'app', ts: '2026-06-26T01:00:00.000Z', msg: 'GET /health ok' },
  {
    pod: 'api-1',
    container: 'app',
    ts: '2026-06-26T01:00:01.000Z',
    msg: 'error connecting to redis error'
  },
  {
    pod: 'api-2',
    container: 'worker',
    ts: '2026-06-26T01:00:02.000Z',
    msg: 'worker error: timeout'
  },
  { pod: 'api-2', container: 'worker', ts: '2026-06-26T01:00:03.000Z', msg: 'all good' }
]

const refs: ResourceRef[] = [{ kind: 'pods', namespace: 'default', name: 'api' }]

function renderPane() {
  return render(<LogsPane clusterId="cluster-a" refs={refs} />)
}

function getLogMessage(text: string) {
  return screen.getByText((_, element) => {
    if (!(element instanceof HTMLElement)) return false
    return element.className.includes('whitespace-pre-wrap') && element.textContent === text
  })
}

async function openSearch() {
  fireEvent.keyDown(window, { key: 'f', metaKey: true })
  const input = await screen.findByRole('textbox', { name: 'Search logs' })
  await waitFor(() => expect(input).toHaveFocus())
  return input
}

beforeEach(() => {
  mocks.scrollToIndex.mockClear()
  mocks.usePodLogs.mockReturnValue({
    lines,
    status: 'streaming',
    paused: false,
    setPaused: vi.fn(),
    clear: vi.fn()
  })
})

describe('LogsPane search', () => {
  it('toggles and focuses search from the toolbar button', async () => {
    const user = userEvent.setup()
    renderPane()
    const searchButton = screen.getByRole('button', { name: 'Search' })

    await user.click(searchButton)

    const input = screen.getByRole('textbox', { name: 'Search logs' })
    await waitFor(() => expect(input).toHaveFocus())
    expect(searchButton).toHaveAttribute('aria-pressed', 'true')

    await user.click(searchButton)

    expect(screen.queryByRole('textbox', { name: 'Search logs' })).not.toBeInTheDocument()
    expect(searchButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('opens and focuses search with Cmd+F', async () => {
    renderPane()

    const input = await openSearch()

    expect(input).toHaveFocus()
  })

  it('shows the current match count for message matches', async () => {
    const user = userEvent.setup()
    renderPane()
    const input = await openSearch()

    await user.type(input, 'error')

    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('moves to next and previous matches with Enter and Shift+Enter', async () => {
    const user = userEvent.setup()
    renderPane()
    const input = await openSearch()
    await user.type(input, 'error')

    await user.keyboard('{Enter}')
    expect(screen.getByText('2 / 3')).toBeInTheDocument()

    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('closes search with Escape without clearing log lines', async () => {
    const user = userEvent.setup()
    renderPane()
    const input = await openSearch()
    await user.type(input, 'error')

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('textbox', { name: 'Search logs' })).not.toBeInTheDocument()
    expect(getLogMessage('worker error: timeout')).toBeInTheDocument()
  })

  it('combines pod filtering with message search', async () => {
    const user = userEvent.setup()
    renderPane()
    const input = await openSearch()
    await user.type(input, 'error')

    await user.click(screen.getByRole('button', { name: 'Pods: all' }))

    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    expect(screen.queryByText('error connecting to redis error')).not.toBeInTheDocument()
    expect(getLogMessage('worker error: timeout')).toBeInTheDocument()
  })
})
