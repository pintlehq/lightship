// Small runtime-validation helpers used at trust boundaries.

import type { z } from 'zod'

/**
 * Parse external / untrusted data, logging a clear diagnostic on failure.
 * Use for data crossing into the app (Kubernetes API results, persisted JSON):
 * a malformed payload throws here instead of silently corrupting state.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const r = schema.safeParse(data)
  if (!r.success) {
    console.error(`[validate] ${label}:`, r.error.issues)
    throw r.error
  }
  return r.data
}

/**
 * Like {@link parseOrThrow} but returns a fallback instead of throwing, so a
 * corrupt on-disk file can't crash startup. Logs the issues first.
 */
export function parseOrFallback<T>(
  schema: z.ZodType<T>,
  data: unknown,
  fallback: T,
  label: string
): T {
  const r = schema.safeParse(data)
  if (!r.success) {
    console.error(`[validate] ${label} — falling back:`, r.error.issues)
    return fallback
  }
  return r.data
}
