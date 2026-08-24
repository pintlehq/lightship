import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './badge'

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge>Ready</Badge>)
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })

  it('applies the default variant classes', () => {
    render(<Badge>default</Badge>)
    expect(screen.getByText('default')).toHaveClass('text-primary')
  })

  it('applies variant-specific classes', () => {
    render(<Badge variant="destructive">err</Badge>)
    expect(screen.getByText('err')).toHaveClass('text-destructive')
  })

  it('merges a custom className', () => {
    render(<Badge className="ml-2">x</Badge>)
    expect(screen.getByText('x')).toHaveClass('ml-2')
  })
})
