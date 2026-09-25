import { create } from 'zustand'
import { toast } from '@renderer/ui/components/toaster'

import type { PortForwardHandle, ResourceRef } from '../../../shared/ipc-types'
import { clusterApi, hasBackend } from '../lib/ipc'
import { recordActivity } from '../lib/record-activity'

export type PortForwardStatus = 'starting' | 'running' | 'stopping' | 'error' | 'closed'

export interface PortForwardSession {
  id: string
  clusterId: string
  ref: ResourceRef
  name: string
  kind: string
  remotePort: number
  localPort: number
  status: PortForwardStatus
  error?: string
}

interface PortForwardsState {
  sessions: PortForwardSession[]
  /** Start a forward and return the new session id. */
  start: (input: {
    clusterId: string
    ref: ResourceRef
    name: string
    remotePort: number
    localPort: number
  }) => string
  stop: (id: string) => void
}

let seq = 0
// Non-serializable handles kept out of the store state.
const handles = new Map<string, PortForwardHandle>()

export const usePortForwardsStore = create<PortForwardsState>((set, get) => ({
  sessions: [],
  start: ({ clusterId, ref, name, remotePort, localPort }) => {
    const id = `pf-${++seq}`
    const patch = (p: Partial<PortForwardSession>): void =>
      set((s) => ({ sessions: s.sessions.map((t) => (t.id === id ? { ...t, ...p } : t)) }))

    const base: PortForwardSession = {
      id,
      clusterId,
      ref,
      name,
      kind: ref.kind,
      remotePort,
      localPort,
      status: 'starting'
    }

    if (!hasBackend()) {
      set((s) => ({
        sessions: [...s.sessions, { ...base, status: 'error', error: 'Backend unavailable' }]
      }))
      toast.error('Port-forward failed', 'Backend unavailable')
      return id
    }

    set((s) => ({ sessions: [...s.sessions, base] }))
    try {
      handles.set(
        id,
        clusterApi.startPortForward(clusterId, ref, { remotePort, localPort }, (ev) => {
          const current = get().sessions.find((item) => item.id === id)
          if (!current || current.status === 'stopping') return
          if (ev.type === 'running') {
            patch({ status: 'running', localPort: ev.localPort })
            toast.success(`Forwarding localhost:${ev.localPort} → ${name}:${remotePort}`)
            recordActivity({
              clusterId,
              action: 'port-forward-start',
              kind: ref.kind,
              namespace: ref.namespace,
              name,
              count: 1,
              outcome: 'success',
              message: `localhost:${ev.localPort} → ${name}:${remotePort}`
            })
          } else if (ev.type === 'error') {
            patch({ status: 'error', error: ev.message })
            toast.error(`Port-forward failed: ${name}`, ev.message)
            recordActivity({
              clusterId,
              action: 'port-forward-start',
              kind: ref.kind,
              namespace: ref.namespace,
              name,
              count: 1,
              outcome: 'error',
              message: ev.message
            })
          } else {
            patch({ status: 'closed' })
          }
        })
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patch({ status: 'error', error: message })
      toast.error(`Port-forward failed: ${name}`, message)
      recordActivity({
        clusterId,
        action: 'port-forward-start',
        kind: ref.kind,
        namespace: ref.namespace,
        name,
        count: 1,
        outcome: 'error',
        message
      })
    }
    return id
  },
  stop: (id) => {
    const session = get().sessions.find((t) => t.id === id)
    if (!session || session.status === 'stopping') return
    const handle = handles.get(id)
    if (!handle) {
      set((s) => ({ sessions: s.sessions.filter((t) => t.id !== id) }))
      return
    }
    const wasRunning = session.status === 'running'
    set((s) => ({
      sessions: s.sessions.map((t) =>
        t.id === id ? { ...t, status: 'stopping', error: undefined } : t
      )
    }))
    void handle
      .stop()
      .then(() => {
        handles.delete(id)
        set((s) => ({ sessions: s.sessions.filter((t) => t.id !== id) }))
        if (wasRunning)
          recordActivity({
            clusterId: session.clusterId,
            action: 'port-forward-stop',
            kind: session.ref.kind,
            namespace: session.ref.namespace,
            name: session.name,
            count: 1,
            outcome: 'success'
          })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        set((s) => ({
          sessions: s.sessions.map((t) =>
            t.id === id ? { ...t, status: 'error', error: message } : t
          )
        }))
        toast.error(`Failed to stop forward: ${session.name}`, message)
        recordActivity({
          clusterId: session.clusterId,
          action: 'port-forward-stop',
          kind: session.ref.kind,
          namespace: session.ref.namespace,
          name: session.name,
          count: 1,
          outcome: 'error',
          message
        })
      })
  }
}))
