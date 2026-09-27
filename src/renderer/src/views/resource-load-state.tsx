import { Button } from '@renderer/ui/components/button'
import { errMsg } from '../lib/errors'

type ResourceQueryState = {
  isPending: boolean
  isFetching: boolean
  isFetchedAfterMount: boolean
  isError: boolean
  error: unknown
  refetch: () => Promise<unknown>
}

/** Never mount resource actions from an unverified snapshot or failed lookup. */
export function ResourceLoadState({
  query,
  found,
  name
}: {
  query: ResourceQueryState
  found: boolean
  name: string
}) {
  if (query.isPending || (!query.isFetchedAfterMount && query.isFetching))
    return (
      <div className="p-5 text-dim" role="status">
        Loading {name}…
      </div>
    )
  if (query.isError)
    return (
      <div className="space-y-3 p-5" role="alert">
        <p>
          Could not load {name}: {errMsg(query.error)}
        </p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    )
  if (!found)
    return (
      <div className="space-y-3 p-5" role="status">
        <p>{name} was not found. It may have been deleted.</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Refresh
        </Button>
      </div>
    )
  return null
}

export function resourceReady(query: ResourceQueryState, found: boolean): boolean {
  return (
    found && !query.isPending && !query.isError && (query.isFetchedAfterMount || !query.isFetching)
  )
}
