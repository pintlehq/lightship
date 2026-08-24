import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, type WebContents } from 'electron'
import { spawn, type IPty } from 'node-pty'

import type { PtyEvent, PtyOptions } from '../../shared/ipc-types'
import { readKubeconfig } from './cluster-store'
import { kubeExecCommand } from './pty-command'

// Coalesce pty output for ~one frame before crossing IPC, to avoid a flood of
// tiny messages on chatty output while staying responsive.
const FLUSH_MS = 16

type Session = { pty: IPty; cleanup: () => void }
const sessions = new Map<string, Session>()

const defaultShell = (): string =>
  process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash'

/** Spawn an interactive shell with KUBECONFIG pointed at the cluster's stored
 *  config (its currentContext is the cluster), streaming output to the renderer
 *  on `cluster:pty:<subId>`. Idempotent per subId. */
export async function startPty(
  sender: WebContents,
  subId: string,
  clusterId: string,
  opts: PtyOptions
): Promise<void> {
  stopPty(subId)

  const send = (ev: PtyEvent): void => {
    if (!sender.isDestroyed()) sender.send(`cluster:pty:${subId}`, ev)
  }

  let kubeconfigPath: string | undefined
  try {
    const yaml = await readKubeconfig(clusterId)
    kubeconfigPath = join(app.getPath('temp'), `lightship-${subId.replace(/\W/g, '_')}.kubeconfig`)
    writeFileSync(kubeconfigPath, yaml, { mode: 0o600 })

    // With an exec target, run `kubectl exec` through the shell (KUBECONFIG points
    // at the cluster); otherwise a plain interactive kube-shell.
    const execCmd = kubeExecCommand(opts)
    const args = execCmd ? [process.platform === 'win32' ? '-Command' : '-c', execCmd] : []
    const ptyProc = spawn(defaultShell(), args, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: homedir(),
      env: { ...process.env, KUBECONFIG: kubeconfigPath, TERM: 'xterm-256color' }
    })

    // Batch data for one frame.
    let buf = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = (): void => {
      timer = null
      if (buf) {
        send({ type: 'data', data: buf })
        buf = ''
      }
    }
    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      timer = null
      if (kubeconfigPath && existsSync(kubeconfigPath)) {
        try {
          unlinkSync(kubeconfigPath)
        } catch {
          /* best effort */
        }
      }
    }

    ptyProc.onData((d) => {
      buf += d
      if (buf.length >= 16_384) flush()
      else if (!timer) timer = setTimeout(flush, FLUSH_MS)
    })
    ptyProc.onExit(({ exitCode }) => {
      flush()
      send({ type: 'exit', exitCode })
      cleanup()
      sessions.delete(subId)
    })

    sessions.set(subId, { pty: ptyProc, cleanup })
    sender.once('destroyed', () => stopPty(subId))
  } catch (e) {
    if (kubeconfigPath && existsSync(kubeconfigPath)) {
      try {
        unlinkSync(kubeconfigPath)
      } catch {
        /* best effort */
      }
    }
    send({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

export function writePty(subId: string, data: string): void {
  sessions.get(subId)?.pty.write(data)
}

export function resizePty(subId: string, cols: number, rows: number): void {
  const s = sessions.get(subId)
  if (s && cols > 0 && rows > 0) s.pty.resize(cols, rows)
}

export function stopPty(subId: string): void {
  const s = sessions.get(subId)
  if (!s) return
  sessions.delete(subId)
  s.cleanup()
  try {
    s.pty.kill()
  } catch {
    /* already exited */
  }
}
