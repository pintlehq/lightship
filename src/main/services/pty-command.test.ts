import { describe, expect, it } from 'vitest'

import { kubeExecCommand } from './pty-command'

describe('kubeExecCommand', () => {
  it('returns null for a plain kube-shell (no exec target)', () => {
    expect(kubeExecCommand({ cols: 80, rows: 24 })).toBeNull()
  })

  it('returns null when only one of pod/namespace is set', () => {
    expect(kubeExecCommand({ cols: 80, rows: 24, pod: 'api' })).toBeNull()
    expect(kubeExecCommand({ cols: 80, rows: 24, namespace: 'web' })).toBeNull()
  })

  it('builds a kubectl exec command, defaulting the container', () => {
    expect(kubeExecCommand({ cols: 80, rows: 24, namespace: 'web', pod: 'api-1' })).toBe(
      'kubectl exec -it -n web api-1 -- sh'
    )
  })

  it('targets a specific container when given', () => {
    expect(
      kubeExecCommand({ cols: 80, rows: 24, namespace: 'web', pod: 'api-1', container: 'sidecar' })
    ).toBe('kubectl exec -it -n web api-1 -c sidecar -- sh')
  })
})
