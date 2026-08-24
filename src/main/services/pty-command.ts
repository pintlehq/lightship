import type { PtyOptions } from '../../shared/ipc-types'

/** The `kubectl exec` command for an exec-targeted pty, or `null` for a plain
 *  kube-shell. The pty spawns the user's shell with this as its `-c` argument.
 *  Inputs are validated to a k8s-name charset upstream (PtyOptionsSchema), so they
 *  are safe to interpolate. Omitting `-c` lets kubectl pick the default container. */
export function kubeExecCommand(opts: PtyOptions): string | null {
  if (!opts.pod || !opts.namespace) return null
  const container = opts.container ? ` -c ${opts.container}` : ''
  return `kubectl exec -it -n ${opts.namespace} ${opts.pod}${container} -- sh`
}
