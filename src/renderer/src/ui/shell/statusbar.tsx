import * as React from 'react'

import { cn } from '@renderer/ui/lib/utils'
import { Icon, type IconName } from '@renderer/ui/components/icon'

export type StatusTone = 'primary' | 'success' | 'warning' | 'destructive'

const TONE: Record<StatusTone, string> = {
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive'
}

export interface StatusSegProps {
  icon?: IconName
  tone?: StatusTone
  children: React.ReactNode
  onClick?: () => void
  className?: string
}

export function StatusSeg({ icon, tone, children, onClick, className }: StatusSegProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-full items-center gap-1.5 whitespace-nowrap px-2.5 transition-colors hover:bg-hover',
        tone ? TONE[tone] : 'text-muted-foreground',
        className
      )}
    >
      {icon && <Icon name={icon} className="h-3 w-3" />}
      {children}
    </button>
  )
}

export function Statusbar({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <footer className="flex h-6 items-center border-t border-border bg-chrome px-1 font-mono text-[11px] text-muted-foreground">
      {left}
      <div className="flex-1" />
      {right}
    </footer>
  )
}
