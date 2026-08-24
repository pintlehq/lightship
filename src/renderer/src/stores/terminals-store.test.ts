import { beforeEach, describe, expect, it } from 'vitest'

import { useTerminalsStore, type TerminalSessionMeta } from './terminals-store'

const session = (id: string): TerminalSessionMeta => ({
  id,
  clusterId: 'cluster-1',
  clusterName: 'cluster-1'
})

beforeEach(() => useTerminalsStore.setState({ sessions: [], activeId: null, focused: false }))

describe('reorderSessions', () => {
  it('reorders sessions without changing the active session', () => {
    useTerminalsStore.setState({
      sessions: [session('a'), session('b'), session('c')],
      activeId: 'b'
    })

    useTerminalsStore.getState().reorderSessions('c', 'a', 'before')

    const s = useTerminalsStore.getState()
    expect(s.sessions.map((t) => t.id)).toEqual(['c', 'a', 'b'])
    expect(s.activeId).toBe('b')
  })

  it('closeToRight follows the reordered session order', () => {
    useTerminalsStore.setState({
      sessions: [session('a'), session('b'), session('c')],
      activeId: 'a'
    })

    useTerminalsStore.getState().reorderSessions('c', 'a', 'before')
    useTerminalsStore.getState().closeToRight('c')

    const s = useTerminalsStore.getState()
    expect(s.sessions.map((t) => t.id)).toEqual(['c'])
    expect(s.activeId).toBe('c')
  })
})
