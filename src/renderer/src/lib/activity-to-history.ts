import type { IconName } from '@renderer/ui/components/icon'
import type { HistoryItem } from '@renderer/ui/lib/types'

import type { ActivityAction, ActivityRecord } from '../../../shared/ipc-types'

const ICON: Record<ActivityAction, IconName> = {
  delete: 'trash',
  restart: 'refresh',
  scale: 'chevronsUpDown',
  cordon: 'server',
  uncordon: 'server',
  drain: 'server',
  'apply-yaml': 'file',
  'create-yaml': 'file',
  'apply-config': 'file',
  'port-forward-start': 'arrowRight',
  'port-forward-stop': 'arrowRight'
}

const VERB: Record<ActivityAction, string> = {
  delete: 'Deleted',
  restart: 'Restarted',
  scale: 'Scaled',
  cordon: 'Cordoned',
  uncordon: 'Uncordoned',
  drain: 'Drained',
  'apply-yaml': 'Applied',
  'create-yaml': 'Created',
  'apply-config': 'Saved',
  'port-forward-start': 'Started port-forward',
  'port-forward-stop': 'Stopped port-forward'
}

/** A coarse "Xm / Xh / Xd ago" string. Kept in this format so HistoryView's
 *  existing time-bucket grouping (Recent / Earlier today / Previous days) works. */
function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/** Project a persisted activity record onto the shared HistoryView's item shape. */
export function activityToHistoryItem(r: ActivityRecord): HistoryItem {
  const target =
    r.count > 1 ? `${r.count} ${r.kind ?? 'resources'}` : [r.kind, r.name].filter(Boolean).join('/')
  const sub = [r.namespace && `ns: ${r.namespace}`, r.clusterName, r.message]
    .filter(Boolean)
    .join(' · ')
  return {
    icon: ICON[r.action],
    label: `${VERB[r.action]} ${target}`.trim(),
    sub: sub || undefined,
    time: relTime(r.ts),
    tone: r.outcome === 'error' ? 'destructive' : undefined
  }
}
