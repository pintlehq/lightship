import { EventEmitter } from 'node:events'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  ConfigDataSaveResultSchema,
  ConfigDataUpdateSchema,
  ResourceRefSchema,
  type ConfigDataUpdate,
  type ResourceRef
} from '../shared/ipc-types'

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    })
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: electronMock.handle }
}))

import { parseArgs, registerInvokeHandler } from './ipc-helpers'
import { registerAppContents } from './electron-boundary'

const documentUrl = 'file:///app/renderer/index.html'
function trustedEvent() {
  const frame = { url: documentUrl }
  const sender = Object.assign(new EventEmitter(), {
    mainFrame: frame,
    getURL: () => documentUrl,
    isDestroyed: () => false
  })
  registerAppContents(sender as unknown as WebContents, documentUrl)
  return { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent
}

describe('registerInvokeHandler', () => {
  let event: IpcMainInvokeEvent
  beforeEach(() => {
    electronMock.handlers.clear()
    electronMock.handle.mockClear()
    event = trustedEvent()
  })

  it('parses input and validates output', async () => {
    registerInvokeHandler(
      'test:ok',
      parseArgs(z.string()),
      z.object({ greeting: z.string() }),
      (_event, name) => ({ greeting: `hello ${name}` })
    )

    await expect(electronMock.handlers.get('test:ok')?.(event, 'Ada')).resolves.toEqual({
      greeting: 'hello Ada'
    })
  })

  it('rejects invalid input', async () => {
    registerInvokeHandler('test:input', parseArgs(z.string()), z.string(), (_event, value) => value)

    await expect(electronMock.handlers.get('test:input')?.(event, 42)).rejects.toThrow()
  })

  it('rejects ConfigMap saves without an original version before invoking the service', async () => {
    const handler = vi.fn(
      (_event: IpcMainInvokeEvent, _id: string, _ref: ResourceRef, _update: ConfigDataUpdate) => ({
        status: 'unchanged' as const,
        current: { secret: false, data: {}, binaryKeys: [], resourceVersion: '10' }
      })
    )
    registerInvokeHandler(
      'cluster:applyConfigData:test',
      parseArgs(z.string(), ResourceRefSchema, ConfigDataUpdateSchema),
      ConfigDataSaveResultSchema,
      handler
    )
    const invoke = electronMock.handlers.get('cluster:applyConfigData:test')
    const ref = { kind: 'configmaps', namespace: 'web', name: 'settings' }
    await expect(invoke?.(event, 'cluster-a', ref, { data: {} })).rejects.toThrow()
    await expect(
      invoke?.(event, 'cluster-a', ref, { resourceVersion: '', data: {} })
    ).rejects.toThrow()
    expect(handler).not.toHaveBeenCalled()
    await expect(
      invoke?.(event, 'cluster-a', ref, { resourceVersion: '10', data: {} })
    ).resolves.toMatchObject({ status: 'unchanged' })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('rejects invalid output', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    registerInvokeHandler(
      'test:output',
      parseArgs(),
      z.object({ ok: z.boolean() }),
      () => ({ ok: 'yes' }) as unknown as { ok: boolean }
    )

    await expect(electronMock.handlers.get('test:output')?.(event)).rejects.toThrow()
    errorSpy.mockRestore()
  })

  it('supports void handlers', async () => {
    const handler = vi.fn()
    registerInvokeHandler('test:void', parseArgs(), z.void(), handler)

    await expect(electronMock.handlers.get('test:void')?.(event)).resolves.toBeUndefined()
    expect(handler).toHaveBeenCalledOnce()
  })

  it('rejects an unregistered sender and a child frame before invoking the handler', async () => {
    const handler = vi.fn()
    registerInvokeHandler('test:trusted', parseArgs(), z.void(), handler)
    const invoke = electronMock.handlers.get('test:trusted')
    await expect(
      invoke?.({ sender: { ...event.sender }, senderFrame: event.senderFrame })
    ).rejects.toThrow('Untrusted renderer frame')
    await expect(
      invoke?.({ sender: event.sender, senderFrame: { url: documentUrl } })
    ).rejects.toThrow('Untrusted renderer frame')
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects a navigated or destroyed owner', async () => {
    const handler = vi.fn()
    registerInvokeHandler('test:navigation', parseArgs(), z.void(), handler)
    const invoke = electronMock.handlers.get('test:navigation')
    await expect(
      invoke?.({
        sender: event.sender,
        senderFrame: { ...event.sender.mainFrame, url: 'https://evil.test' }
      })
    ).rejects.toThrow('Untrusted renderer frame')
    event.sender.emit('destroyed')
    await expect(invoke?.(event)).rejects.toThrow('Untrusted renderer frame')
    expect(handler).not.toHaveBeenCalled()
  })
})
