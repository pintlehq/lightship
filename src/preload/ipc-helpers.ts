import { ipcRenderer } from 'electron'

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
  void invoke<void>(startChannel, subId, ...startArgs)
  return () => {
    ipcRenderer.removeListener(channel, listener)
    void invoke<void>(stopChannel, subId)
  }
}
