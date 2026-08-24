/** A human-readable message from an unknown thrown/rejected value (IPC errors,
 *  exceptions) — used as the description of failure toasts. */
export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
