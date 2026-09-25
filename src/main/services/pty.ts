import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, type WebContents } from 'electron'
import { spawn, type IPty, type IDisposable } from 'node-pty'

import type { PtyEvent, PtyOptions } from '../../shared/ipc-types'
import { readKubeconfig } from './cluster-store'
import { kubeExecCommand } from './pty-command'

const FLUSH_MS = 16

type Session = {
  sender: WebContents
  active: boolean
  controller: AbortController
  onDestroyed: () => void
  pty?: IPty
  dataListener?: IDisposable
  exitListener?: IDisposable
  credentialDir?: string
  buffer: string
  timer: ReturnType<typeof setTimeout> | null
}
const sessions = new Map<string, Session>()

const defaultShell = (): string =>
  process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash'

function current(subId: string, session: Session): boolean {
  return session.active && sessions.get(subId) === session && !session.sender.isDestroyed()
}

function send(subId: string, session: Session, event: PtyEvent): void {
  if (current(subId, session)) session.sender.send(`cluster:pty:${subId}`, event)
}

function dispose(subId: string, session: Session, kill: boolean): void {
  if (!session.active) return
  session.active = false
  if (sessions.get(subId) === session) sessions.delete(subId)
  session.controller.abort()
  session.sender.removeListener('destroyed', session.onDestroyed)
  if (session.timer) clearTimeout(session.timer)
  session.timer = null
  session.buffer = ''
  session.dataListener?.dispose()
  session.exitListener?.dispose()
  if (kill) {
    try {
      session.pty?.kill()
    } catch {
      // A naturally exited pty may already be gone.
    }
  }
  if (session.credentialDir) {
    try {
      rmSync(session.credentialDir, { recursive: true, force: true, maxRetries: 2 })
    } catch (error) {
      console.error('Failed to remove temporary kubeconfig', error)
    }
    session.credentialDir = undefined
  }
}

function flush(subId: string, session: Session): void {
  session.timer = null
  if (session.buffer) {
    send(subId, session, { type: 'data', data: session.buffer })
    session.buffer = ''
  }
}

/** Register ownership before returning the start acknowledgement. Setup errors
 * are delivered as events; a stopped session cannot acquire late resources. */
export function startPty(
  sender: WebContents,
  subId: string,
  clusterId: string,
  opts: PtyOptions
): void {
  const previous = sessions.get(subId)
  if (previous) {
    if (previous.sender.id !== sender.id)
      throw new Error('Terminal session belongs to another window')
    dispose(subId, previous, true)
  }
  const session: Session = {
    sender,
    active: true,
    controller: new AbortController(),
    onDestroyed: () => dispose(subId, session, true),
    buffer: '',
    timer: null
  }
  sessions.set(subId, session)
  sender.once('destroyed', session.onDestroyed)
  if (sender.isDestroyed()) {
    dispose(subId, session, true)
    return
  }

  void (async () => {
    try {
      const yaml = await readKubeconfig(clusterId)
      if (!current(subId, session)) return
      const dir = mkdtempSync(join(app.getPath('temp'), 'lightship-'))
      session.credentialDir = dir
      if (process.platform !== 'win32') chmodSync(dir, 0o700)
      const kubeconfigPath = join(dir, 'config')
      writeFileSync(kubeconfigPath, yaml, { flag: 'wx', mode: 0o600 })
      if (!current(subId, session)) return

      const execCmd = kubeExecCommand(opts)
      const args = execCmd ? [process.platform === 'win32' ? '-Command' : '-c', execCmd] : []
      const proc = spawn(defaultShell(), args, {
        name: 'xterm-256color',
        cols: opts.cols,
        rows: opts.rows,
        cwd: homedir(),
        env: { ...process.env, KUBECONFIG: kubeconfigPath, TERM: 'xterm-256color' }
      })
      session.pty = proc
      if (!current(subId, session)) {
        dispose(subId, session, true)
        return
      }
      session.dataListener = proc.onData((data) => {
        if (!current(subId, session)) return
        session.buffer += data
        if (session.buffer.length >= 16_384) flush(subId, session)
        else if (!session.timer) session.timer = setTimeout(() => flush(subId, session), FLUSH_MS)
      })
      session.exitListener = proc.onExit(({ exitCode }) => {
        if (!current(subId, session)) return
        flush(subId, session)
        send(subId, session, { type: 'exit', exitCode })
        dispose(subId, session, false)
      })
    } catch (error) {
      if (current(subId, session)) {
        send(subId, session, {
          type: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
        dispose(subId, session, true)
      }
    }
  })()
}

export function writePty(sender: WebContents, subId: string, data: string): void {
  const session = sessions.get(subId)
  if (session?.sender.id === sender.id && session.active) session.pty?.write(data)
}

export function resizePty(sender: WebContents, subId: string, cols: number, rows: number): void {
  const session = sessions.get(subId)
  if (session?.sender.id === sender.id && session.active && cols > 0 && rows > 0) {
    session.pty?.resize(cols, rows)
  }
}

export function stopPty(sender: WebContents, subId: string): void {
  const session = sessions.get(subId)
  if (session?.sender.id === sender.id) dispose(subId, session, true)
}
