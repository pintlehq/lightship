import * as React from 'react'

import { cn } from '@renderer/ui/lib/utils'

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('rounded-lg border border-border bg-card', className)}
      {...props}
    />
  )
}

/* Optional sub-parts (kept lightweight; the design mostly uses bare Card). */
function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="card-header" className={cn('flex flex-col gap-1 p-4', className)} {...props} />
  )
}
function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('font-mono text-sm font-medium text-foreground', className)}
      {...props}
    />
  )
}
function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('font-mono text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}
function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('p-4 pt-0', className)} {...props} />
}
function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center p-4 pt-0', className)}
      {...props}
    />
  )
}
function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-action" className={cn('ml-auto', className)} {...props} />
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent }
