import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

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

describe('registerInvokeHandler', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    electronMock.handle.mockClear()
  })

  it('parses input and validates output', async () => {
    registerInvokeHandler(
      'test:ok',
      parseArgs(z.string()),
      z.object({ greeting: z.string() }),
      (_event, name) => ({ greeting: `hello ${name}` })
    )

    await expect(electronMock.handlers.get('test:ok')?.({}, 'Ada')).resolves.toEqual({
      greeting: 'hello Ada'
    })
  })

  it('rejects invalid input', async () => {
    registerInvokeHandler('test:input', parseArgs(z.string()), z.string(), (_event, value) => value)

    await expect(electronMock.handlers.get('test:input')?.({}, 42)).rejects.toThrow()
  })

  it('rejects invalid output', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    registerInvokeHandler(
      'test:output',
      parseArgs(),
      z.object({ ok: z.boolean() }),
      () => ({ ok: 'yes' }) as unknown as { ok: boolean }
    )

    await expect(electronMock.handlers.get('test:output')?.({})).rejects.toThrow()
    errorSpy.mockRestore()
  })

  it('supports void handlers', async () => {
    const handler = vi.fn()
    registerInvokeHandler('test:void', parseArgs(), z.void(), handler)

    await expect(electronMock.handlers.get('test:void')?.({})).resolves.toBeUndefined()
    expect(handler).toHaveBeenCalledOnce()
  })
})
