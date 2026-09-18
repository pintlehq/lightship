import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, screen } from '@testing-library/dom'
import { openSearchPanel, searchKeymap, searchPanelOpen } from '@codemirror/search'
import { EditorView, keymap } from '@codemirror/view'

import { lightshipSearch } from './cm-search'

describe('Lightship CodeMirror search', () => {
  let host: HTMLDivElement
  let view: EditorView

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    view = new EditorView({
      parent: host,
      doc: 'alpha beta alpha',
      extensions: [lightshipSearch, keymap.of(searchKeymap)]
    })
  })

  afterEach(() => {
    view.destroy()
    host.remove()
  })

  const open = () => {
    openSearchPanel(view)
    return screen.getByRole<HTMLInputElement>('textbox', { name: 'Find in editor' })
  }

  it('opens with the platform find shortcut and navigates with Enter and Shift+Enter', () => {
    view.focus()
    fireEvent.keyDown(view.contentDOM, { key: 'f', code: 'KeyF', ctrlKey: true })
    expect(searchPanelOpen(view.state)).toBe(true)
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Find in editor' })
    expect(input).toHaveFocus()

    fireEvent.input(input, { target: { value: 'alpha' } })
    expect(screen.getByRole('status')).toHaveTextContent('0 / 2')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('status')).toHaveTextContent('1 / 2')
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(screen.getByRole('status')).toHaveTextContent('2 / 2')
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }))
    expect(screen.getByRole('status')).toHaveTextContent('1 / 2')
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(screen.getByRole('status')).toHaveTextContent('2 / 2')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(searchPanelOpen(view.state)).toBe(false)
  })

  it('filters matches with case, whole word, and regex controls', () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'foo Foo foobar foo' } })
    const input = open()
    fireEvent.input(input, { target: { value: 'foo' } })
    expect(screen.getByRole('status')).toHaveTextContent('0 / 4')

    fireEvent.click(screen.getByRole('button', { name: 'Whole word' }))
    expect(screen.getByRole('status')).toHaveTextContent('0 / 3')
    fireEvent.click(screen.getByRole('button', { name: 'Match case' }))
    expect(screen.getByRole('status')).toHaveTextContent('0 / 2')
    fireEvent.click(screen.getByRole('button', { name: 'Regular expression' }))
    fireEvent.input(input, { target: { value: '[' } })
    expect(screen.getByRole('status')).toHaveTextContent('Invalid regex')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled()
  })

  it('replaces only the editor draft and updates match counts', () => {
    const input = open()
    fireEvent.input(input, { target: { value: 'alpha' } })
    fireEvent.click(screen.getByRole('button', { name: 'Toggle replace' }))
    const replaceInput = screen.getByRole<HTMLInputElement>('textbox', { name: 'Replace with' })
    fireEvent.input(replaceInput, { target: { value: 'gamma' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace current match' }))
    expect(view.state.doc.toString()).toBe('gamma beta alpha')
    fireEvent.click(screen.getByRole('button', { name: 'Replace all matches' }))

    expect(view.state.doc.toString()).toBe('gamma beta gamma')
    expect(screen.getByRole('status')).toHaveTextContent('0 / 0')
  })
})
