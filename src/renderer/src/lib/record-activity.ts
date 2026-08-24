import type { ActivityInput } from '../../../shared/ipc-types'
import { useActivityStore } from '../stores/activity-store'
import { activityApi } from './ipc'

/** Fire-and-forget: persist one mutating action and surface it in the open
 *  History tab. Never blocks or throws into the mutation path. Without a backend
 *  (plain browser) the record call no-ops and nothing is added. */
export function recordActivity(input: ActivityInput): void {
  void activityApi.record(input).then((rec) => {
    if (rec) useActivityStore.getState().prepend(rec)
  })
}
