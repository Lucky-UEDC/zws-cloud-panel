function serializeError(error: unknown) {
  if (!error) return null
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || null,
      code: (error as any).code || null,
      status: (error as any).status || (error as any).statusCode || null,
    }
  }
  if (typeof error === "object") {
    const record = error as Record<string, unknown>
    return {
      name: String(record.name || "Error"),
      message: String(record.message || JSON.stringify(record)),
      stack: record.stack || null,
      code: record.code || null,
      status: record.status || record.statusCode || null,
    }
  }
  return { name: "Error", message: String(error), stack: null }
}

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string") {
    if (/^rzp_(test|live)_/i.test(value)) return `${value.slice(0, 12)}...`
    return value.length > 2000 ? `${value.slice(0, 2000)}...[truncated]` : value
  }
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return value.map((item) => sanitize(item))
  if (typeof value !== "object") return String(value)
  const output: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = /secret|signature|password|token|authorization|auth|keySecret|passwordEncrypted/i.test(key)
      ? "[redacted]"
      : sanitize(nested)
  }
  return output
}

export function paymentFlowLog(message: string, metadata: Record<string, unknown> = {}) {
  const { error, ...rest } = metadata
  console.info(`[PAYMENT] ${message}`, {
    at: new Date().toISOString(),
    ...sanitize(rest) as Record<string, unknown>,
    ...(error ? { error: serializeError(error) } : {}),
  })
}

export function paymentFlowError(message: string, error: unknown, metadata: Record<string, unknown> = {}) {
  console.error(`[PAYMENT] ${message}`, {
    at: new Date().toISOString(),
    ...sanitize(metadata) as Record<string, unknown>,
    error: serializeError(error),
  })
}

export function taggedPaymentFlowLog(tag: "CHECKOUT" | "RAZORPAY" | "PAYMENT" | "WEBHOOK" | "PROVISION" | "EMAIL" | "WHATSAPP", message: string, metadata: Record<string, unknown> = {}) {
  console.info(`[${tag}] ${message}`, {
    at: new Date().toISOString(),
    ...sanitize(metadata) as Record<string, unknown>,
  })
}

export function taggedPaymentFlowError(tag: "CHECKOUT" | "RAZORPAY" | "PAYMENT" | "WEBHOOK" | "PROVISION" | "EMAIL" | "WHATSAPP", message: string, error: unknown, metadata: Record<string, unknown> = {}) {
  console.error(`[${tag}] ${message}`, {
    at: new Date().toISOString(),
    ...sanitize(metadata) as Record<string, unknown>,
    error: serializeError(error),
  })
}
