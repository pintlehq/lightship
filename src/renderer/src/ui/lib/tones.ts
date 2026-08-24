import type { Tone } from './types'

/** Static tone → class maps. Static so Tailwind never purges them (the
 * prototype built these dynamically as `text-${tone}`, which would be stripped). */
export const TONE_TEXT: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  info: 'text-info',
  dim: 'text-dim',
  primary: 'text-primary'
}

export const TONE_BG: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  info: 'bg-info',
  dim: 'bg-faint',
  primary: 'bg-primary'
}
