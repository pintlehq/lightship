import { describe, expect, it, vi } from 'vitest'
import {
  RESOURCE_CATALOG,
  resourceCollectionPath,
  type GenericResourceId
} from '../../shared/resource-catalog'
import { GVK } from './resource-gvk'
import { RESOURCE_MAPPERS } from './resource-mappers'
import { WATCH_SPECS } from './resource-watch-specs'

vi.mock('./k8s-client', () => ({}))

describe('built-in resource catalog', () => {
  it('covers GVKs and every generic list/watch with explicit pod/node exceptions', () => {
    expect(Object.keys(GVK).sort()).toEqual(
      Object.keys(RESOURCE_CATALOG)
        .filter((id) => id !== 'nodes')
        .sort()
    )
    expect(GVK.nodes).toBeUndefined()
    const genericIds = Object.keys(RESOURCE_CATALOG).filter((id) => !['pods', 'nodes'].includes(id))
    expect(Object.keys(WATCH_SPECS).sort()).toEqual(genericIds.sort())
    expect(Object.keys(RESOURCE_MAPPERS).sort()).toEqual(genericIds.sort())
    for (const id of genericIds as GenericResourceId[]) {
      expect(WATCH_SPECS[id].path).toBe(resourceCollectionPath(id))
      expect(GVK[id]).toMatchObject({
        kind: RESOURCE_CATALOG[id].kind,
        namespaced: RESOURCE_CATALOG[id].namespaced,
        apiVersion: RESOURCE_CATALOG[id].apiVersion
      })
    }
  })

  it('uses API plural names rather than sidebar aliases', () => {
    expect(resourceCollectionPath('pvc')).toBe('/api/v1/persistentvolumeclaims')
    expect(resourceCollectionPath('pv')).toBe('/api/v1/persistentvolumes')
    expect(resourceCollectionPath('crd')).toBe(
      '/apis/apiextensions.k8s.io/v1/customresourcedefinitions'
    )
  })
})
