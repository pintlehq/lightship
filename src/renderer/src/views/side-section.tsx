import { Fragment } from 'react'

/** A labelled key/value section used in resource / custom-resource detail
 *  Properties panels. `labelWidth` widens the key column for long field names. */
export function SideSection({
  title,
  rows,
  labelWidth = '100px'
}: {
  title: string
  rows: Array<[string, string]>
  labelWidth?: string
}) {
  return (
    <>
      <h4 className="mb-1.5 mt-4 text-2xs font-medium uppercase tracking-[0.08em] text-dim first:mt-0">
        {title}
      </h4>
      <dl className="grid gap-x-2.5 gap-y-1" style={{ gridTemplateColumns: `${labelWidth} 1fr` }}>
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-dim">{k}</dt>
            <dd className="m-0 break-all text-foreground">{v}</dd>
          </Fragment>
        ))}
      </dl>
    </>
  )
}
