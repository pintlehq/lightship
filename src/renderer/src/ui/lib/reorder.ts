import type { TabbarReorderPlacement } from './types'

export function reorderById<T extends { id: string }>(
  items: T[],
  draggedId: string,
  targetId: string,
  placement: TabbarReorderPlacement
): T[] {
  if (draggedId === targetId) return items

  const draggedIndex = items.findIndex((item) => item.id === draggedId)
  const targetIndex = items.findIndex((item) => item.id === targetId)
  if (draggedIndex === -1 || targetIndex === -1) return items

  const next = items.slice()
  const [dragged] = next.splice(draggedIndex, 1)
  const targetIndexAfterRemoval = next.findIndex((item) => item.id === targetId)
  const insertIndex = placement === 'before' ? targetIndexAfterRemoval : targetIndexAfterRemoval + 1
  next.splice(insertIndex, 0, dragged)

  return next.every((item, index) => item.id === items[index]?.id) ? items : next
}
