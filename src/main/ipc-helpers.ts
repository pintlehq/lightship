import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'

import { parseOrThrow } from '../shared/validate'

type Parser<T> = { parse(data: unknown): T }

export function parseArgs<T extends unknown[]>(...schemas: { [K in keyof T]: Parser<T[K]> }) {
  return (rawArgs: unknown[]): T =>
    schemas.map((schema, index) => schema.parse(rawArgs[index])) as T
}

export function registerInvokeHandler<TArgs extends unknown[], TResult>(
  channel: string,
  inputParser: (rawArgs: unknown[]) => TArgs,
  outputSchema: z.ZodType<TResult> | undefined,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
): void {
  ipcMain.handle(channel, async (event, ...rawArgs: unknown[]) => {
    const result = await handler(event, ...inputParser(rawArgs))
    return outputSchema ? parseOrThrow(outputSchema, result, channel) : result
  })
}
