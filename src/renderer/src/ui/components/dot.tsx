import { cn } from '@renderer/ui/lib/utils'
import { TONE_BG } from '@renderer/ui/lib/tones'
import type { Tone } from '@renderer/ui/lib/types'

export interface DotProps {
  tone?: Tone
  pulse?: boolean
  className?: string
}

function Dot({ tone = 'success', pulse, className }: DotProps) {
  return (
    <span
      className={cn('inline-block h-[7px] w-[7px] rounded-full', TONE_BG[tone], className)}
      style={pulse ? { animation: 'pulse-dot 1.8s ease-in-out infinite' } : undefined}
    />
  )
}

export { Dot }
