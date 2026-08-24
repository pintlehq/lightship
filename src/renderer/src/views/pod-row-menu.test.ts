import { describe, expect, it, vi } from 'vitest'

import { buildPodRowMenu } from './pod-row-menu'

const noop = (): void => {}
const base = { onOpen: noop, onLogs: noop, onExec: noop, onDelete: noop }

describe('buildPodRowMenu', () => {
  it('is flat (no submenus) for a single-container pod', () => {
    const items = buildPodRowMenu({ ...base, containers: ['app'], readOnly: false })
    expect(items.map((i) => i.label)).toEqual(['Open', 'Logs', 'Exec', 'Delete'])
    expect(items.every((i) => !i.submenu)).toBe(true)
  })

  it('single-container Logs/Exec target that container', () => {
    const onLogs = vi.fn()
    const onExec = vi.fn()
    const items = buildPodRowMenu({ ...base, containers: ['app'], readOnly: false, onLogs, onExec })
    items.find((i) => i.label === 'Logs')!.onSelect?.()
    items.find((i) => i.label === 'Exec')!.onSelect?.()
    expect(onLogs).toHaveBeenCalledWith('app')
    expect(onExec).toHaveBeenCalledWith('app')
  })

  it('builds Logs/Exec submenus for a multi-container pod', () => {
    const onLogs = vi.fn()
    const onExec = vi.fn()
    const items = buildPodRowMenu({
      ...base,
      containers: ['app', 'istio-proxy'],
      readOnly: false,
      onLogs,
      onExec
    })
    const logs = items.find((i) => i.label === 'Logs')!
    const exec = items.find((i) => i.label === 'Exec')!
    expect(logs.submenu?.map((s) => s.label)).toEqual(['All containers', 'app', 'istio-proxy'])
    expect(exec.submenu?.map((s) => s.label)).toEqual(['app', 'istio-proxy'])

    logs.submenu![0].onSelect?.() // All containers → onLogs()
    logs.submenu![2].onSelect?.() // istio-proxy → onLogs('istio-proxy')
    exec.submenu![1].onSelect?.() // istio-proxy
    expect(onLogs.mock.calls[0]).toEqual([]) // "All containers" = no filter
    expect(onLogs).toHaveBeenNthCalledWith(2, 'istio-proxy')
    expect(onExec).toHaveBeenCalledWith('istio-proxy')
  })

  it('marks Delete destructive and read-only-gated', () => {
    const del = buildPodRowMenu({ ...base, containers: ['app'], readOnly: true }).find(
      (i) => i.label === 'Delete'
    )!
    expect(del.danger).toBe(true)
    expect(del.disabled).toBe(true)
  })
})
