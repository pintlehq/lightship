import { Fragment, type ReactNode } from 'react'
import { Dot } from '@renderer/ui/components/dot'

export interface ViewHeaderProps {
  crumbs?: string[]
  title: ReactNode
  meta?: ReactNode
  live?: boolean
}

export function ViewHeader({ crumbs, title, meta, live }: ViewHeaderProps) {
  return (
    <div className="mb-3.5 flex items-center gap-3">
      <div className="font-mono text-[14px] font-semibold text-foreground">
        {crumbs && (
          <span className="font-normal text-dim">
            {crumbs.map((c, i) => (
              <Fragment key={i}>
                {c}
                <span className="px-1.5 text-faint">/</span>
              </Fragment>
            ))}
          </span>
        )}
        {title}
      </div>
      <div className="ml-auto flex items-center gap-3.5 font-mono text-xs text-dim">
        {meta}
        {live && (
          <span className="inline-flex items-center gap-1.5 text-success">
            <Dot tone="success" pulse />
            live
          </span>
        )}
      </div>
    </div>
  )
}
