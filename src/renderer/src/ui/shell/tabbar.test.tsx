import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Tabbar, type TabbarTab } from './tabbar'

const tabs: TabbarTab[] = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Charlie' }
]

const dataTransfer = () => ({
  effectAllowed: 'move',
  dropEffect: 'move',
  setData: vi.fn(),
  getData: vi.fn()
})

const tabElement = (label: string): HTMLElement => {
  const el = screen.getByText(label).closest('[data-tab-id]')
  if (!el) throw new Error(`Missing tab ${label}`)
  return el as HTMLElement
}

const setRect = (el: HTMLElement) => {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 24,
      width: 100,
      height: 24,
      toJSON: () => ({})
    })
  })
}

const dragOver = (el: HTMLElement, clientX: number, dt: ReturnType<typeof dataTransfer>) => {
  const event = createEvent.dragOver(el, { dataTransfer: dt })
  Object.defineProperty(event, 'clientX', { value: clientX })
  fireEvent(el, event)
}

const drop = (el: HTMLElement, clientX: number, dt: ReturnType<typeof dataTransfer>) => {
  const event = createEvent.drop(el, { dataTransfer: dt })
  Object.defineProperty(event, 'clientX', { value: clientX })
  fireEvent(el, event)
}

describe('Tabbar', () => {
  it('calls onReorder with a before placement', () => {
    const onReorder = vi.fn()
    render(<Tabbar tabs={tabs} activeId="a" onSelect={vi.fn()} onReorder={onReorder} />)

    const alpha = tabElement('Alpha')
    const charlie = tabElement('Charlie')
    setRect(charlie)
    const dt = dataTransfer()

    fireEvent.dragStart(alpha, { dataTransfer: dt })
    dragOver(charlie, 25, dt)
    drop(charlie, 25, dt)

    expect(onReorder).toHaveBeenCalledWith('a', 'c', 'before')
  })

  it('calls onReorder with an after placement', () => {
    const onReorder = vi.fn()
    render(<Tabbar tabs={tabs} activeId="a" onSelect={vi.fn()} onReorder={onReorder} />)

    const alpha = tabElement('Alpha')
    const charlie = tabElement('Charlie')
    setRect(charlie)
    const dt = dataTransfer()

    fireEvent.dragStart(alpha, { dataTransfer: dt })
    dragOver(charlie, 75, dt)
    drop(charlie, 75, dt)

    expect(onReorder).toHaveBeenCalledWith('a', 'c', 'after')
  })

  it('does not select a tab after drag/drop suppresses the click', () => {
    const onSelect = vi.fn()
    render(<Tabbar tabs={tabs} activeId="a" onSelect={onSelect} onReorder={vi.fn()} />)

    const alpha = tabElement('Alpha')
    const charlie = tabElement('Charlie')
    setRect(charlie)
    const dt = dataTransfer()

    fireEvent.dragStart(alpha, { dataTransfer: dt })
    dragOver(charlie, 25, dt)
    drop(charlie, 25, dt)
    fireEvent.click(alpha)

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('still selects on click and closes from the close button', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(
      <Tabbar tabs={tabs} activeId="a" onSelect={onSelect} onClose={onClose} onReorder={vi.fn()} />
    )

    fireEvent.click(tabElement('Beta'))
    expect(onSelect).toHaveBeenCalledWith('b')

    fireEvent.click(screen.getByRole('button', { name: 'Close Beta' }))
    expect(onClose).toHaveBeenCalledWith('b')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
