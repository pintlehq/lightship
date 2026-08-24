import { describe, expect, it, vi } from 'vitest'

import { buildResourceRowMenu } from './resource-row-menu'

const noop = (): void => {}
const base = { onOpen: noop, onLogs: noop, onRestart: noop, onScale: noop, onDelete: noop }

describe('buildResourceRowMenu', () => {
  it('includes Rolling restart only for restartable kinds', () => {
    const restartable = buildResourceRowMenu({
      ...base,
      loggable: false,
      restartable: true,
      scalable: false,
      readOnly: false
    })
    expect(restartable.map((i) => i.label)).toEqual(['Open', 'Rolling restart', 'Delete'])

    const plain = buildResourceRowMenu({
      ...base,
      loggable: false,
      restartable: false,
      scalable: false,
      readOnly: false
    })
    expect(plain.map((i) => i.label)).toEqual(['Open', 'Delete'])
  })

  it('includes Logs only for loggable kinds, after Open', () => {
    const loggable = buildResourceRowMenu({
      ...base,
      loggable: true,
      restartable: true,
      scalable: false,
      readOnly: false
    })
    expect(loggable.map((i) => i.label)).toEqual(['Open', 'Logs', 'Rolling restart', 'Delete'])

    const notLoggable = buildResourceRowMenu({
      ...base,
      loggable: false,
      restartable: false,
      scalable: false,
      readOnly: false
    })
    expect(notLoggable.map((i) => i.label)).not.toContain('Logs')
  })

  it('includes Scale only for scalable kinds', () => {
    const scalable = buildResourceRowMenu({
      ...base,
      loggable: false,
      restartable: true,
      scalable: true,
      readOnly: false
    })
    expect(scalable.map((i) => i.label)).toEqual(['Open', 'Scale', 'Rolling restart', 'Delete'])

    const plain = buildResourceRowMenu({
      ...base,
      loggable: false,
      restartable: true,
      scalable: false,
      readOnly: false
    })
    expect(plain.map((i) => i.label)).not.toContain('Scale')
  })

  it('keeps Logs enabled in read-only (it is a read action)', () => {
    const items = buildResourceRowMenu({
      ...base,
      loggable: true,
      restartable: false,
      scalable: false,
      readOnly: true
    })
    expect(items.find((i) => i.label === 'Logs')?.disabled).toBeFalsy()
  })

  it('marks Delete as destructive', () => {
    const items = buildResourceRowMenu({
      ...base,
      loggable: false,
      restartable: false,
      scalable: false,
      readOnly: false
    })
    expect(items.find((i) => i.label === 'Delete')?.danger).toBe(true)
  })

  it('disables mutating items under read-only but leaves Open enabled', () => {
    const items = buildResourceRowMenu({
      ...base,
      loggable: false,
      restartable: true,
      scalable: true,
      readOnly: true
    })
    const byLabel = Object.fromEntries(items.map((i) => [i.label, i]))
    expect(byLabel['Open'].disabled).toBeFalsy()
    expect(byLabel['Scale'].disabled).toBe(true)
    expect(byLabel['Rolling restart'].disabled).toBe(true)
    expect(byLabel['Delete'].disabled).toBe(true)
  })

  it('wires each item to its handler', () => {
    const onOpen = vi.fn()
    const onLogs = vi.fn()
    const onRestart = vi.fn()
    const onScale = vi.fn()
    const onDelete = vi.fn()
    const items = buildResourceRowMenu({
      loggable: true,
      restartable: true,
      scalable: true,
      readOnly: false,
      onOpen,
      onLogs,
      onRestart,
      onScale,
      onDelete
    })
    for (const it of items) it.onSelect?.()
    expect(onOpen).toHaveBeenCalledOnce()
    expect(onLogs).toHaveBeenCalledOnce()
    expect(onScale).toHaveBeenCalledOnce()
    expect(onRestart).toHaveBeenCalledOnce()
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
