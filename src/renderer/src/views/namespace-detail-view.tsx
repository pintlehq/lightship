import { useState } from 'react'
import { Badge } from '@renderer/ui/components/badge'
import { Card } from '@renderer/ui/components/card'
import { Icon } from '@renderer/ui/components/icon'
import { Tabs } from '@renderer/ui/components/tabs'

import type { NamespaceAccess } from '../../../shared/ipc-types'
import { useEvents, useNamespaceDetail } from '../queries/use-lightship-data'
import { EventList } from './event-list'
import { StatCard } from './stat-card'
import { YamlEditor } from './yaml-editor'

const SHORTCUTS: Array<{ group: string; resources: Array<[string, string]> }> = [
  {
    group: 'Workloads',
    resources: [
      ['pods', 'Pods'],
      ['deployments', 'Deployments'],
      ['statefulsets', 'StatefulSets'],
      ['daemonsets', 'DaemonSets'],
      ['jobs', 'Jobs'],
      ['cronjobs', 'CronJobs']
    ]
  },
  {
    group: 'Networking',
    resources: [
      ['services', 'Services'],
      ['ingresses', 'Ingresses']
    ]
  },
  {
    group: 'Config',
    resources: [
      ['configmaps', 'ConfigMaps'],
      ['secrets', 'Secrets']
    ]
  },
  { group: 'Storage', resources: [['pvc', 'PVClaims']] },
  {
    group: 'Access control',
    resources: [
      ['roles', 'Roles'],
      ['rolebindings', 'RoleBindings'],
      ['serviceaccounts', 'ServiceAccounts']
    ]
  }
]

function Unavailable({ access, noun }: { access: NamespaceAccess; noun: string }) {
  if (access.available) return null
  return (
    <Card className="m-5 flex items-start gap-2 border-warning/30 bg-warning/10 p-4 font-mono text-[12px] text-warning">
      <Icon name="alertTriangle" className="mt-0.5 h-3.5 w-3.5" />
      <span>
        {noun} are unavailable with your current cluster permissions. {access.message}
      </span>
    </Card>
  )
}

function KeyValues({ values, empty }: { values: Record<string, string>; empty: string }) {
  const entries = Object.entries(values)
  return entries.length ? (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <span
          key={key}
          className="rounded border border-border bg-background px-2 py-1 font-mono text-[11px]"
        >
          <span className="text-info">{key}</span>
          <span className="text-faint">=</span>
          <span>{value}</span>
        </span>
      ))}
    </div>
  ) : (
    <span className="font-mono text-[12px] text-dim">{empty}</span>
  )
}

function RecordValues({ label, values }: { label: string; values: Record<string, string> }) {
  return (
    <div>
      <div className="mb-1 text-2xs uppercase tracking-[0.06em] text-dim">{label}</div>
      {Object.keys(values).length ? (
        <div className="flex flex-wrap gap-1">
          {Object.entries(values).map(([key, value]) => (
            <Badge key={key} variant="secondary">
              {key}: {value}
            </Badge>
          ))}
        </div>
      ) : (
        <span className="text-faint">—</span>
      )}
    </div>
  )
}

export function NamespaceDetailView({
  clusterId,
  name,
  onOpenResource
}: {
  clusterId: string
  name: string
  onOpenResource: (resourceId: string, label: string, namespace: string) => void
}) {
  const query = useNamespaceDetail(clusterId, name)
  const { data: events = [] } = useEvents(clusterId, { kind: 'namespaces', name })
  const [tab, setTab] = useState('overview')
  const detail = query.data
  const tabs = [
    { value: 'overview', label: 'Overview' },
    { value: 'quotas', label: 'Quotas', count: detail?.quotas?.length || undefined },
    { value: 'limits', label: 'Limits', count: detail?.limitRanges?.length || undefined },
    { value: 'policies', label: 'Policies', count: detail?.networkPolicies?.length || undefined },
    { value: 'yaml', label: 'YAML' },
    { value: 'events', label: 'Events', count: events.length || undefined }
  ]

  if (query.isLoading)
    return (
      <div className="grid h-full place-items-center font-mono text-sm text-dim">
        Loading namespace…
      </div>
    )
  if (query.isError || !detail)
    return (
      <div className="grid h-full place-items-center p-6 font-mono text-sm text-destructive">
        {query.error instanceof Error ? query.error.message : 'Failed to load namespace'}
      </div>
    )
  const state = detail.podStates

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center border-b border-border bg-chrome px-2">
        <Tabs value={tab} onChange={setTab} tabs={tabs} />
        <div className="ml-auto flex items-center gap-2 pr-2">
          <Badge variant={detail.summary.status === 'Active' ? 'success' : 'warning'}>
            {detail.summary.status}
          </Badge>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'overview' && (
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-4 gap-3">
              <StatCard label="Pods" value={state?.total ?? '—'} />
              <StatCard label="Ready" value={state ? `${state.ready}/${state.total}` : '—'} />
              <StatCard label="Quotas" value={detail.quotas?.length ?? '—'} />
              <StatCard label="Policies" value={detail.networkPolicies?.length ?? '—'} />
            </div>
            {!detail.access.pods.available && (
              <Unavailable access={detail.access.pods} noun="Pod totals" />
            )}
            <Card className="space-y-4 p-4 font-mono text-[12px]">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="mb-1 text-2xs uppercase tracking-[0.06em] text-dim">Created</div>
                  <span>{detail.summary.created || '—'}</span>
                </div>
                <div>
                  <div className="mb-1 text-2xs uppercase tracking-[0.06em] text-dim">
                    Finalizers
                  </div>
                  <span>{detail.finalizers.join(', ') || 'None'}</span>
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-2xs uppercase tracking-[0.06em] text-dim">Labels</div>
                <KeyValues values={detail.labels} empty="No labels" />
              </div>
              <div>
                <div className="mb-1.5 text-2xs uppercase tracking-[0.06em] text-dim">
                  Annotations
                </div>
                <KeyValues values={detail.annotations} empty="No annotations" />
              </div>
            </Card>
            {state && (
              <Card className="p-4">
                <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.08em] text-dim">
                  Pod states
                </h3>
                <div className="grid grid-cols-6 gap-2">
                  {(['running', 'pending', 'succeeded', 'failed', 'unknown'] as const).map(
                    (key) => (
                      <div key={key}>
                        <div className="font-mono text-xl tabular-nums">{state[key]}</div>
                        <div className="font-mono text-2xs capitalize text-dim">{key}</div>
                      </div>
                    )
                  )}
                </div>
              </Card>
            )}
            <Card className="p-4">
              <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.08em] text-dim">
                Resources in this namespace
              </h3>
              <div className="grid grid-cols-5 gap-4">
                {SHORTCUTS.map(({ group, resources }) => (
                  <div key={group}>
                    <div className="mb-1.5 font-mono text-2xs uppercase text-dim">{group}</div>
                    <div className="space-y-1">
                      {resources.map(([id, label]) => (
                        <button
                          key={id}
                          className="block font-mono text-[12px] text-primary hover:underline"
                          onClick={() => onOpenResource(id, label, name)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
        {tab === 'quotas' && (
          <>
            {!detail.access.quotas.available ? (
              <Unavailable access={detail.access.quotas} noun="Resource quotas" />
            ) : (
              <div className="space-y-3 p-5">
                {detail.quotas?.length ? (
                  detail.quotas.map((quota) => (
                    <Card key={quota.name} className="overflow-hidden">
                      <div className="border-b border-border bg-muted px-4 py-2 font-mono text-[12px] font-semibold">
                        {quota.name}
                      </div>
                      <table className="w-full font-mono text-[12px]">
                        <thead>
                          <tr className="text-left text-2xs uppercase text-dim">
                            <th className="px-4 py-2">Resource</th>
                            <th>Used</th>
                            <th>Hard</th>
                            <th className="w-1/3">Utilization</th>
                          </tr>
                        </thead>
                        <tbody>
                          {quota.resources.map((resource) => (
                            <tr key={resource.resource} className="border-t border-border/50">
                              <td className="px-4 py-2">{resource.resource}</td>
                              <td>{resource.used}</td>
                              <td>{resource.hard}</td>
                              <td className="pr-4">
                                <div className="flex items-center gap-2">
                                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
                                    <span
                                      className="block h-full bg-primary"
                                      style={{ width: `${Math.min(resource.percent ?? 0, 100)}%` }}
                                    />
                                  </div>
                                  <span>
                                    {resource.percent == null ? '—' : `${resource.percent}%`}
                                  </span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Card>
                  ))
                ) : (
                  <Card className="p-8 text-center font-mono text-[12px] text-dim">
                    No ResourceQuotas
                  </Card>
                )}
              </div>
            )}
          </>
        )}
        {tab === 'limits' && (
          <>
            {!detail.access.limits.available ? (
              <Unavailable access={detail.access.limits} noun="Limit ranges" />
            ) : (
              <div className="space-y-3 p-5">
                {detail.limitRanges?.length ? (
                  detail.limitRanges.map((range) => (
                    <Card key={range.name} className="p-4">
                      <h3 className="mb-3 font-mono text-[13px] font-semibold">{range.name}</h3>
                      {range.limits.map((limit, index) => (
                        <div
                          key={index}
                          className="grid grid-cols-5 gap-4 border-t border-border/60 py-3 font-mono text-[11px]"
                        >
                          <RecordValues label={`Type: ${limit.type}`} values={{}} />
                          <RecordValues label="Minimum" values={limit.min} />
                          <RecordValues label="Maximum" values={limit.max} />
                          <RecordValues label="Default" values={limit.default} />
                          <RecordValues label="Default request" values={limit.defaultRequest} />
                        </div>
                      ))}
                    </Card>
                  ))
                ) : (
                  <Card className="p-8 text-center font-mono text-[12px] text-dim">
                    No LimitRanges
                  </Card>
                )}
              </div>
            )}
          </>
        )}
        {tab === 'policies' && (
          <>
            {!detail.access.policies.available ? (
              <Unavailable access={detail.access.policies} noun="Network policies" />
            ) : (
              <div className="space-y-3 p-5">
                <div className="rounded-md border border-info/30 bg-info/10 p-3 font-mono text-[11.5px] text-info">
                  These indicators describe declared NetworkPolicies. Enforcement depends on the
                  cluster network plugin.
                </div>
                {detail.networkPolicies?.length ? (
                  detail.networkPolicies.map((policy) => (
                    <Card key={policy.name} className="p-4 font-mono text-[12px]">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{policy.name}</h3>
                        {policy.defaultDenyIngress && (
                          <Badge variant="warning">default deny ingress</Badge>
                        )}
                        {policy.defaultDenyEgress && (
                          <Badge variant="warning">default deny egress</Badge>
                        )}
                      </div>
                      <div className="mt-3 grid grid-cols-4 gap-4">
                        <div>
                          <div className="text-2xs uppercase text-dim">Pod selector</div>
                          {policy.selector}
                        </div>
                        <div>
                          <div className="text-2xs uppercase text-dim">Policy types</div>
                          {policy.policyTypes.join(', ')}
                        </div>
                        <div>
                          <div className="text-2xs uppercase text-dim">Ingress rules</div>
                          {policy.ingressRules}
                        </div>
                        <div>
                          <div className="text-2xs uppercase text-dim">Egress rules</div>
                          {policy.egressRules}
                        </div>
                      </div>
                    </Card>
                  ))
                ) : (
                  <Card className="p-8 text-center font-mono text-[12px] text-dim">
                    No NetworkPolicies
                  </Card>
                )}
              </div>
            )}
          </>
        )}
        {tab === 'yaml' && (
          <YamlEditor clusterId={clusterId} refTarget={{ kind: 'namespaces', name }} />
        )}
        {tab === 'events' && (
          <div className="p-5">
            <EventList events={events} />
          </div>
        )}
      </div>
    </div>
  )
}
