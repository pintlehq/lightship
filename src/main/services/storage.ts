import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600

export function storagePaths(): {
  clusters: string
  preferences: string
  activity: string
} {
  const userData = app.getPath('userData')
  const lightshipData = join(userData, 'lightship-data')
  return {
    clusters: join(lightshipData, 'configs', 'clusters.json'),
    preferences: join(lightshipData, 'configs', 'preferences.json'),
    activity: join(lightshipData, 'history', 'activity.json')
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

export async function readFileIfPresent(path: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return undefined
    throw error
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true, mode: DIRECTORY_MODE })
  if (process.platform !== 'win32') await fs.chmod(path, DIRECTORY_MODE)
}

export async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const parent = dirname(path)
  await ensurePrivateDirectory(parent)

  const temporaryPath = join(parent, `.${basename(path)}.${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined

  try {
    handle = await fs.open(temporaryPath, 'wx', FILE_MODE)
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await fs.rename(temporaryPath, path)
  } finally {
    await handle?.close().catch(() => undefined)
    await fs.unlink(temporaryPath).catch(() => undefined)
  }
}

export class SerialQueue {
  private tail: Promise<void> = Promise.resolve()

  wait(): Promise<void> {
    return this.tail
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
