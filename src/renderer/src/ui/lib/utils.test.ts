import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c')
  })

  it('drops falsy values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b')
  })

  it('supports conditional object syntax', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active')
  })

  it('lets later Tailwind classes win on conflict (tailwind-merge)', () => {
    expect(cn('px-2 text-sm', 'px-4')).toBe('text-sm px-4')
    const merged = cn('text-success', 'text-destructive')
    expect(merged).toContain('text-destructive')
    expect(merged).not.toContain('text-success')
  })
})
