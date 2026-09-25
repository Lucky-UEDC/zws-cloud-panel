import { classifyEnterpriseError, type EnterpriseErrorKind } from "@/lib/enterprise-error-classifier"

export type SafeQueryResult<T> = {
  data: T
  warning: string | null
  errorKind: EnterpriseErrorKind | null
  rawError?: unknown
}

export const SCHEMA_OUT_OF_DATE_MESSAGE = "Database schema is out of date. Run production migration."

export function humanDatabaseError(error: unknown, fallback = "Admin data is partially unavailable.") {
  const classified = classifyEnterpriseError(error)
  if (classified.kind === "migration_missing" || classified.kind === "schema_mismatch") return SCHEMA_OUT_OF_DATE_MESSAGE
  if (classified.kind === "connection_failure") return "Database connection is temporarily unavailable."
  return fallback
}

export async function safeAdminQuery<T>(
  label: string,
  query: () => Promise<T>,
  fallback: T,
): Promise<SafeQueryResult<T>> {
  try {
    return {
      data: await query(),
      warning: null,
      errorKind: null,
    }
  } catch (error) {
    const classified = classifyEnterpriseError(error)
    const warning = humanDatabaseError(error)
    console.warn("[admin-safe-query] query failed", {
      label,
      kind: classified.kind,
      code: classified.code,
      message: (error as any)?.message || String(error),
    })
    return {
      data: fallback,
      warning,
      errorKind: classified.kind,
      rawError: error,
    }
  }
}
