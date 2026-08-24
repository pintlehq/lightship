import { describe, expect, it } from 'vitest'

import type { ResourceRow } from '../../../shared/ipc-types'
import { groupCrds, humanizeKind } from './crd-tree'

const crd = (name: string, columns: Record<string, string>): ResourceRow => ({
  uid: name,
  name,
  age: '1d',
  columns
})

describe('humanizeKind', () => {
  it('splits PascalCase into words', () => {
    expect(humanizeKind('AckAlertRule')).toBe('Ack Alert Rule')
    expect(humanizeKind('CiliumNetworkPolicy')).toBe('Cilium Network Policy')
  })

  it('keeps acronym runs together but splits the trailing word', () => {
    expect(humanizeKind('HTTPRoute')).toBe('HTTP Route')
    expect(humanizeKind('TLSOption')).toBe('TLS Option')
  })

  it('passes single words through', () => {
    expect(humanizeKind('Foo')).toBe('Foo')
  })
})

describe('groupCrds', () => {
  const rows: ResourceRow[] = [
    crd('ciliumnetworkpolicies.cilium.io', {
      group: 'cilium.io',
      kind: 'CiliumNetworkPolicy',
      scope: 'Namespaced',
      plural: 'ciliumnetworkpolicies',
      version: 'v2'
    }),
    crd('ackalertrules.alert.alibabacloud.com', {
      group: 'alert.alibabacloud.com',
      kind: 'AckAlertRule',
      scope: 'Cluster',
      plural: 'ackalertrules',
      version: 'v1'
    }),
    crd('httproutes.gateway.networking.k8s.io', {
      group: 'gateway.networking.k8s.io',
      kind: 'HTTPRoute',
      scope: 'Namespaced',
      plural: 'httproutes',
      version: 'v1beta1'
    }),
    crd('tcproutes.gateway.networking.k8s.io', {
      group: 'gateway.networking.k8s.io',
      kind: 'TCPRoute',
      scope: 'Namespaced',
      plural: 'tcproutes',
      version: 'v1alpha2'
    })
  ]

  it('buckets by API group, groups sorted alphabetically', () => {
    const groups = groupCrds(rows)
    expect(groups.map((g) => g.group)).toEqual([
      'alert.alibabacloud.com',
      'cilium.io',
      'gateway.networking.k8s.io'
    ])
  })

  it('sorts kinds within a group by display name and carries instance params', () => {
    const gateway = groupCrds(rows).find((g) => g.group === 'gateway.networking.k8s.io')!
    expect(gateway.crds.map((c) => c.displayName)).toEqual(['HTTP Route', 'TCP Route'])
    expect(gateway.crds[0]).toMatchObject({
      name: 'httproutes.gateway.networking.k8s.io',
      kind: 'HTTPRoute',
      version: 'v1beta1',
      plural: 'httproutes',
      namespaced: true
    })
  })

  it('maps Cluster scope to namespaced=false', () => {
    const alert = groupCrds(rows).find((g) => g.group === 'alert.alibabacloud.com')!
    expect(alert.crds[0].namespaced).toBe(false)
  })

  it('returns [] for no rows', () => {
    expect(groupCrds([])).toEqual([])
  })
})
