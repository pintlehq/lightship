import type { ActivityInput } from '../../../shared/ipc-types'
import { toast } from '@renderer/ui/components/toaster'
import { useActivityStore } from '../stores/activity-store'
import { activityApi } from './ipc'

/** Keep a failed record available for retry without repeating the Kubernetes action. */
export function queueFailedActivity(input: ActivityInput): void {
  useActivityStore.getState().enqueueFailed(input)
  toast.error('Activity history was not saved', 'Retry the record from History.')
}

/** History persistence never changes the Kubernetes mutation's outcome. */
export function recordActivity(input: ActivityInput): void {
  void (async () => {
    try {
      const rec = await activityApi.record(input)
      if (rec) useActivityStore.getState().prepend(rec)
    } catch {
      queueFailedActivity(input)
    }
  })()
}
