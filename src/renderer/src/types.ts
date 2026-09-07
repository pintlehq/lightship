import type { IconName } from '@renderer/ui/components/icon'
import type { Tone } from '@renderer/ui/lib/types'
import { z } from 'zod'

import {
  CustomResourceColumnSchema,
  PodSchema,
  NodeRowSchema,
  ResourceRefSchema,
  ResourceRowSchema
} from '../../shared/ipc-types'

// `Pod` / `NodeRow` / `ResourceRow` cross the renderer↔main boundary, so they live
// once in `shared/ipc-types.ts`. Re-exported here so renderer code keeps importing
// them from `../types` as before.
export { PodSchema, NodeRowSchema, ResourceRowSchema }
export type { Pod, NodeRow, ResourceRow } from '../../shared/ipc-types'

// Types that embed @renderer/ui's `Tone` / `IconName` stay plain interfaces — those
// unions are owned by the UI package and intentionally not duplicated as schemas.
export interface Cluster {
  id: string
  name: string
  env: string
  health: Tone
  active?: boolean
}

export interface ManageClusterRow {
  name: string
  env: string
  health: Tone
  ver: string
  nodes: number
  ctx: string
  sync: string
}

export interface KubeEvent {
  tone: Tone
  type: string
  reason: string
  obj: string
  msg: string
  age: string
}

export interface LightshipTreeChild {
  id: string
  label: string
  icon?: IconName
  count?: number
}

export interface LightshipTreeNode {
  type: 'group' | 'item'
  id: string
  label: string
  icon?: IconName
  count?: number
  children?: LightshipTreeChild[]
}

// Each cluster-bound view carries its own `clusterId`, so a tab stays pinned to
// the cluster it was opened in — independent of any other tab. The cluster-agnostic
// views (clusters / history / port-forwards / generic) omit it.
export const LightshipViewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('overview'), clusterId: z.string() }),
  z.object({ kind: z.literal('pods'), clusterId: z.string() }),
  z.object({ kind: z.literal('nodes'), clusterId: z.string() }),
  z.object({ kind: z.literal('namespaces'), clusterId: z.string() }),
  z.object({ kind: z.literal('namespace-detail'), clusterId: z.string(), name: z.string() }),
  z.object({ kind: z.literal('node-detail'), clusterId: z.string(), node: NodeRowSchema }),
  z.object({ kind: z.literal('pod'), clusterId: z.string(), pod: PodSchema }),
  z.object({ kind: z.literal('clusters') }),
  z.object({ kind: z.literal('history') }),
  z.object({ kind: z.literal('port-forwards') }),
  z.object({
    kind: z.literal('resource'),
    clusterId: z.string(),
    resourceId: z.string(),
    label: z.string()
  }),
  z.object({
    kind: z.literal('resource-detail'),
    clusterId: z.string(),
    resourceId: z.string(),
    label: z.string(),
    row: ResourceRowSchema
  }),
  z.object({
    kind: z.literal('logs'),
    clusterId: z.string(),
    refs: z.array(ResourceRefSchema),
    label: z.string(),
    container: z.string().optional()
  }),
  z.object({
    kind: z.literal('crd-instances'),
    clusterId: z.string(),
    group: z.string(),
    version: z.string(),
    plural: z.string(),
    namespaced: z.boolean(),
    crdKind: z.string(),
    label: z.string()
  }),
  z.object({
    kind: z.literal('crd-instance-detail'),
    clusterId: z.string(),
    group: z.string(),
    version: z.string(),
    plural: z.string(),
    namespaced: z.boolean(),
    crdKind: z.string(),
    columns: z.array(CustomResourceColumnSchema),
    row: ResourceRowSchema,
    label: z.string()
  }),
  z.object({ kind: z.literal('helm'), clusterId: z.string() }),
  z.object({
    kind: z.literal('helm-release'),
    clusterId: z.string(),
    namespace: z.string(),
    name: z.string(),
    label: z.string()
  }),
  z.object({ kind: z.literal('generic'), label: z.string() })
])
export type LightshipView = z.infer<typeof LightshipViewSchema>
