export const BILLABLE_ORDER_KINDS = new Set(["backup_plan", "backup_plan_renewal", "backup_storage_upgrade", "snapshot_charge"])

export function metadataOf(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>
  return {}
}

export function orderKind(order: any): string | null {
  const metadata = metadataOf(order?.metadata)
  const kind = String(metadata.kind || "").trim().toLowerCase()
  return kind || null
}

export function isBillableOrder(order: any): boolean {
  const kind = orderKind(order)
  return Boolean(kind && BILLABLE_ORDER_KINDS.has(kind))
}