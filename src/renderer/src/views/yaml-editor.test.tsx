import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  error: null as Error | null
}))

vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="YAML manifest"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  EditorView: { lineWrapping: [] }
}))

vi.mock('../queries/use-lightship-data', () => ({
  useResourceYaml: () => ({ data: 'original YAML', isLoading: false, isError: false }),
  useClusters: () => ({ data: [{ id: 'cluster-a', name: 'Production' }] }),
  useApplyYaml: () => ({
    mutate: mocks.mutate,
    isPending: false,
    isError: mocks.error !== null,
    error: mocks.error
  })
}))

import { YamlEditor } from './yaml-editor'

const refTarget = { kind: 'deployments', namespace: 'web', name: 'api' }

beforeEach(() => {
  mocks.mutate.mockReset()
  mocks.error = null
})

describe('YamlEditor apply confirmation', () => {
  it('shows the selected cluster and resource, then cancels without saving or losing the draft', () => {
    render(<YamlEditor clusterId="cluster-a" refTarget={refTarget} />)
    const editor = screen.getByRole('textbox', { name: 'YAML manifest' })
    fireEvent.change(editor, { target: { value: 'edited YAML' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(screen.getByText('Apply changes to deployments/api?')).toBeInTheDocument()
    expect(screen.getByText('Cluster: Production')).toBeInTheDocument()
    expect(screen.getByText('Namespace: web')).toBeInTheDocument()
    expect(screen.getByText(/Stale versions are rejected/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mocks.mutate).not.toHaveBeenCalled()
    expect(editor).toHaveValue('edited YAML')
  })

  it('keeps the draft and shows an apply error inside the confirmation', () => {
    const view = render(<YamlEditor clusterId="cluster-a" refTarget={refTarget} />)
    const editor = screen.getByRole('textbox', { name: 'YAML manifest' })
    fireEvent.change(editor, { target: { value: 'edited YAML' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    mocks.error = new Error('Manifest metadata.name must match the selected resource')
    view.rerender(<YamlEditor clusterId="cluster-a" refTarget={refTarget} />)

    expect(screen.getByRole('alert')).toHaveTextContent('metadata.name must match')
    expect(editor).toHaveValue('edited YAML')
    expect(screen.getByRole('button', { name: 'Reset', hidden: true })).toBeEnabled()
  })

  it('shows cluster scope and falls back to the cluster ID when the name is unavailable', () => {
    render(<YamlEditor clusterId="not-loaded" refTarget={{ kind: 'pv', name: 'disk-a' }} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'YAML manifest' }), {
      target: { value: 'edited YAML' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(screen.getByText('Cluster: not-loaded')).toBeInTheDocument()
    expect(screen.getByText('Cluster-scoped')).toBeInTheDocument()
  })
})
