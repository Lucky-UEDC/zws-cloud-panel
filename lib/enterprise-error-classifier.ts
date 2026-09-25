export type EnterpriseErrorKind =
  | "migration_missing"
  | "schema_mismatch"
  | "query_failure"
  | "connection_failure"

export type EnterpriseErrorClassification = {
  kind: EnterpriseErrorKind
  code: string | null
  message: string
  retryable: boolean
}

function normalizeErrorMessage(error: unknown) {
  return String((error as any)?.message || "").trim()
}

function normalizeErrorCode(error: unknown) {
  const code = (error as any)?.code
  return code ? String(code).trim() : null
}

export function classifyEnterpriseError(error: unknown): EnterpriseErrorClassification {
  const message = normalizeErrorMessage(error)
  const code = normalizeErrorCode(error)
  const lower = message.toLowerCase()

  if (code === "P2021" || /does not exist|relation .* does not exist|_prisma_migrations/.test(lower)) {
    return {
      kind: "migration_missing",
      code,
      message: "Required database tables are missing. Deploy Prisma migrations.",
      retryable: false,
    }
  }

  if (code === "P2022" || /column .* does not exist|schema mismatch|invalid input syntax/.test(lower)) {
    return {
      kind: "schema_mismatch",
      code,
      message: "Database schema is not compatible with this application version.",
      retryable: false,
    }
  }

  if (
    code === "P1001" ||
    code === "P1002" ||
    /connection|timeout|econnrefused|terminated unexpectedly|could not connect/.test(lower)
  ) {
    return {
      kind: "connection_failure",
      code,
      message: "Database connection failure detected.",
      retryable: true,
    }
  }

  return {
    kind: "query_failure",
    code,
    message: "Database query failed.",
    retryable: true,
  }
}

export function isEnterpriseSchemaCompatibilityError(error: unknown) {
  const kind = classifyEnterpriseError(error).kind
  return kind === "migration_missing" || kind === "schema_mismatch"
}

