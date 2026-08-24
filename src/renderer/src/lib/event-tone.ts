/** Map a Kubernetes event to a Badge variant / Dot tone. */
export function eventTone(e: { type: string; reason: string }): 'info' | 'warning' | 'destructive' {
  if (e.type === 'Warning')
    return /BackOff|Failed|Unhealthy|Error/.test(e.reason) ? 'destructive' : 'warning'
  return 'info'
}
