import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { TerminalSession } from './terminal-session'

const mocks = vi.hoisted(() => ({
  term: {
    cols: 80,
    rows: 24,
    options: {},
    open: vi.fn(),
    loadAddon: vi.fn(),
    onData: vi.fn(),
    write: vi.fn(),
    writeln: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn()
  },
  fit: vi.fn(),
  openTerminal: vi.fn(),
  handle: { write: vi.fn(), resize: vi.fn(), kill: vi.fn() },
  observe: vi.fn(),
  disconnect: vi.fn()
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor() {
      return mocks.term
    }
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = mocks.fit
  }
}))
vi.mock('../lib/ipc', () => ({
  clusterApi: { openTerminal: mocks.openTerminal },
  hasBackend: () => true
}))

const session = { id: 'terminal', clusterId: 'cluster', clusterName: 'Cluster' }
let width: number
let height: number
let notifyResize: () => void
let nextFrame: number
const frames = new Map<number, FrameRequestCallback>()

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fit.mockReset()
  mocks.openTerminal.mockReturnValue(mocks.handle)
  mocks.handle.kill.mockResolvedValue(undefined)
  mocks.term.cols = 80
  mocks.term.rows = 24
  width = 600
  height = 240
  nextFrame = 0
  frames.clear()
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this)
      }
      observe = mocks.observe
      unobserve = vi.fn()
      disconnect = mocks.disconnect
    }
  )
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback)
      return nextFrame
    })
  )
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => frames.delete(id))
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function flushFrames() {
  act(() => {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(0)
  })
}

it('fits the observed host and sends the fitted dimensions on resize', () => {
  render(<TerminalSession session={session} active />)
  expect(mocks.observe).toHaveBeenCalledWith(mocks.term.open.mock.calls[0][0])
  flushFrames()
  mocks.fit.mockImplementation(() => {
    mocks.term.cols = 90
    mocks.term.rows = 12
  })

  act(() => notifyResize())

  expect(mocks.handle.resize).toHaveBeenLastCalledWith(90, 12)
  expect(mocks.openTerminal).toHaveBeenCalledOnce()
})

it('skips hidden measurements and refits on activation without restarting the session', () => {
  const { rerender } = render(<TerminalSession session={session} active />)
  width = 0
  height = 0
  rerender(<TerminalSession session={session} active={false} />)
  mocks.fit.mockClear()
  mocks.handle.resize.mockClear()
  act(() => notifyResize())
  flushFrames()
  expect(mocks.fit).not.toHaveBeenCalled()
  expect(mocks.handle.resize).not.toHaveBeenCalled()
  expect(mocks.term.focus).not.toHaveBeenCalled()

  width = 400
  height = 160
  rerender(<TerminalSession session={session} active />)
  flushFrames()
  expect(mocks.fit).toHaveBeenCalledOnce()
  expect(mocks.handle.resize).toHaveBeenCalledWith(80, 24)
  expect(mocks.term.focus).toHaveBeenCalledOnce()
  expect(mocks.openTerminal).toHaveBeenCalledOnce()
})

it('does not send stale dimensions when fitting fails', () => {
  render(<TerminalSession session={session} active />)
  mocks.fit.mockImplementation(() => {
    throw new Error('Cells not measured')
  })
  act(() => notifyResize())
  flushFrames()
  expect(mocks.handle.resize).not.toHaveBeenCalled()
  expect(mocks.term.focus).not.toHaveBeenCalled()
})

it('cancels activation and ignores queued resize callbacks after unmount', () => {
  const { unmount } = render(<TerminalSession session={session} active />)
  mocks.fit.mockClear()
  unmount()
  act(() => notifyResize())
  flushFrames()

  expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
  expect(mocks.disconnect).toHaveBeenCalledOnce()
  expect(mocks.handle.kill).toHaveBeenCalledOnce()
  expect(mocks.term.dispose).toHaveBeenCalledOnce()
  expect(mocks.fit).not.toHaveBeenCalled()
  expect(mocks.handle.resize).not.toHaveBeenCalled()
  expect(mocks.term.focus).not.toHaveBeenCalled()
})
