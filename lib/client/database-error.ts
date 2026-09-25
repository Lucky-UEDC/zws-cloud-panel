const DATABASE_REPAIR_MESSAGES: Record<string, string> = {
  assigned_ip_missing_in_database: "Assigned IP record is missing; automatic repair is queued.",
  assigned_ip_gateway_missing_in_database: "Assigned IP gateway is missing; automatic repair is queued.",
  assigned_ip_dns_missing_in_database: "Assigned IP DNS settings are missing; automatic repair is queued.",
  database_password_missing: "Server credentials are being repaired; please try again shortly.",
  database_missing: "Server database metadata is being repaired; please try again shortly.",
  customer_missing: "Customer ownership metadata is being repaired; please try again shortly.",
  order_missing: "Order metadata is being repaired; please try again shortly.",
  provisioning_data_missing: "Provisioning metadata is being repaired; please try again shortly.",
}

function normalizeCode(value: unknown) {
  return String(value || "").trim().toLowerCase()
}

export function customerDatabaseRepairMessage(input: { error?: unknown; code?: unknown; requestId?: unknown } | unknown) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : { error: input }
  const candidates = [body.code, body.error, body.message].map(normalizeCode)
  const matchedCode = Object.keys(DATABASE_REPAIR_MESSAGES).find((code) => candidates.some((candidate) => candidate.includes(code)))
  if (!matchedCode) return String(body.error || body.message || "Action failed")
  const suffix = body.requestId ? ` Reference ${String(body.requestId)}.` : ""
  return `${DATABASE_REPAIR_MESSAGES[matchedCode]}${suffix}`
}
