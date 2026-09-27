import { expect, it } from 'vitest'
import { RESOURCE_CATALOG, builtinResource } from '../../../shared/resource-catalog'
import { RESOURCE_REGISTRY, isResourceId } from './registry'

it('covers generic resource screens and derives scope/capabilities from the catalog', () => {
  const dedicated = ['pods', 'nodes', 'namespaces']
  expect(Object.keys(RESOURCE_REGISTRY).sort()).toEqual(
    Object.keys(RESOURCE_CATALOG)
      .filter((id) => !dedicated.includes(id))
      .sort()
  )
  for (const [id, descriptor] of Object.entries(RESOURCE_REGISTRY)) {
    const resource = builtinResource(id)
    expect(resource).toBeDefined()
    expect(descriptor.namespaced).toBe(resource?.namespaced)
    expect(descriptor).toMatchObject(resource?.capabilities ?? {})
    expect(descriptor.id).toBe(id)
    expect(descriptor.label).toBeTruthy()
  }
  expect(isResourceId('toString')).toBe(false)
})
