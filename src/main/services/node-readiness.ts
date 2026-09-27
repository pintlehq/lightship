export const isReady = (conditions?: Array<{ type?: string; status?: string }>): boolean =>
  (conditions ?? []).some((c) => c.type === 'Ready' && c.status === 'True')
