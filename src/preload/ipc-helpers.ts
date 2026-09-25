import { ipcRenderer } from 'electron'
import { randomUUID } from 'node:crypto'

import {
  DrainEventSchema,
  type DrainHandle,
  type DrainProgress,
  type DrainResult
} from '../shared/ipc-types'

export function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

export function createSubscription<TEvent>({
  subId,
  eventPrefix,
  startChannel,
  stopChannel,
  startArgs,
  onEvent
}: {
  subId: string
  eventPrefix: string
  startChannel: string
  stopChannel: string
  startArgs: unknown[]
  onEvent: (event: TEvent) => void
}): () => void {
  const channel = `${eventPrefix}:${subId}`
  const listener = (_event: unknown, event: TEvent): void => onEvent(event)
  ipcRenderer.on(channel, listener)
  void invoke<void>(startChannel, subId, ...startArgs).catch((error: unknown) => {
    console.error(`${startChannel} failed`, error)
  })
  return () => {
    ipcRenderer.removeListener(channel, listener)
    void invoke<void>(stopChannel, subId).catch((error: unknown) => {
      console.error(`${stopChannel} failed`, error)
    })
  }
}

/** Start acknowledgement means main has registered the session, not that its
 * asynchronous setup is complete. An early stop waits for that acknowledgement. */
export function createManagedSubscription<TEvent>({
  prefix,
  eventPrefix,
  startChannel,
  stopChannel,
  startArgs,
  onEvent,
  errorEvent
}: {
  prefix: string
  eventPrefix: string
  startChannel: string
  stopChannel: string
  startArgs: unknown[]
  onEvent: (event: TEvent) => void
  errorEvent: (message: string) => TEvent
}): { subId: string; stop(): Promise<void>; reportError(error: unknown): void } {
  const subId = `${prefix}:${randomUUID()}`
  const channel = `${eventPrefix}:${subId}`
  let active = true
  let stopPromise: Promise<void> | undefined
  const reportError = (error: unknown): void => {
    if (active) onEvent(errorEvent(error instanceof Error ? error.message : String(error)))
  }
  const listener = (_event: unknown, event: TEvent): void => {
    if (active) onEvent(event)
  }
  ipcRenderer.on(channel, listener)
  const started = invoke<void>(startChannel, subId, ...startArgs).then(
    () => true,
    (error: unknown) => {
      reportError(error)
      return false
    }
  )
  return {
    subId,
    reportError,
    stop: () => {
      if (stopPromise) return stopPromise
      active = false
      ipcRenderer.removeListener(channel, listener)
      stopPromise = started
        .then((registered) => (registered ? invoke<void>(stopChannel, subId) : undefined))
        .catch((error: unknown) => {
          stopPromise = undefined // A failed stop can be retried by the owner.
          throw error
        })
      return stopPromise
    }
  }
}

/** Subscribe before invoking; a cancel requested before registration is sent
 * only after the main process acknowledges ownership of the operation. */
export function createDrainOperation(
  id: string,
  name: string,
  onProgress: (progress: DrainProgress) => void
): DrainHandle {
  const subId = `drain:${randomUUID()}`
  const channel = `cluster:drain:${subId}`
  let started = false
  let cancelled = false
  const sendCancel = (): void => {
    void invoke<void>('cluster:cancelDrain', subId).catch((error: unknown) => {
      console.error('Failed to cancel drain', error)
    })
  }
  const listener = (_event: unknown, raw: unknown): void => {
    const event = DrainEventSchema.parse(raw)
    if (event.type === 'progress') onProgress(event.progress)
    else {
      started = true
      if (cancelled) sendCancel()
    }
  }
  ipcRenderer.on(channel, listener)
  const result = invoke<DrainResult>('cluster:drain', subId, id, name).finally(() => {
    ipcRenderer.removeListener(channel, listener)
  })
  return {
    result,
    cancel: () => {
      if (cancelled) return
      cancelled = true
      if (started) sendCancel()
    }
  }
}
