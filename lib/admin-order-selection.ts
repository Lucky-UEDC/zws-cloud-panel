export type VisibleSelectionSummary = {
  selectedCount: number
  visibleSelectedCount: number
  hiddenSelectedCount: number
  allVisibleSelected: boolean
  partiallyVisibleSelected: boolean
}

export function toggleSelectedId(current: Set<string>, id: string, checked?: boolean): Set<string> {
  const next = new Set(current)
  const shouldSelect = checked ?? !next.has(id)
  if (shouldSelect) {
    next.add(id)
  } else {
    next.delete(id)
  }
  return next
}

export function setVisibleSelection(current: Set<string>, visibleIds: string[], select: boolean): Set<string> {
  const next = new Set(current)
  for (const id of visibleIds) {
    if (!id) continue
    if (select) {
      next.add(id)
    } else {
      next.delete(id)
    }
  }
  return next
}

export function clearHiddenSelection(current: Set<string>, visibleIds: string[]): Set<string> {
  const visible = new Set(visibleIds)
  const next = new Set<string>()
  for (const id of current) {
    if (visible.has(id)) next.add(id)
  }
  return next
}

export function removeSelectedIds(current: Set<string>, ids: string[]): Set<string> {
  const next = new Set(current)
  for (const id of ids) {
    next.delete(id)
  }
  return next
}

export function summarizeVisibleSelection(current: Set<string>, visibleIds: string[]): VisibleSelectionSummary {
  let visibleSelectedCount = 0
  for (const id of visibleIds) {
    if (current.has(id)) visibleSelectedCount += 1
  }

  const selectedCount = current.size
  const hiddenSelectedCount = Math.max(0, selectedCount - visibleSelectedCount)
  return {
    selectedCount,
    visibleSelectedCount,
    hiddenSelectedCount,
    allVisibleSelected: visibleIds.length > 0 && visibleSelectedCount === visibleIds.length,
    partiallyVisibleSelected: visibleSelectedCount > 0 && visibleSelectedCount < visibleIds.length,
  }
}
