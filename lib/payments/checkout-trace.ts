import crypto from "node:crypto"

const SECRET_KEY_RE = /(secret|password|token|authorization|signature|cookie|keySecret|webhookSecret|clientSecret|razorpayKeySecret|PHONEPE_CLIENT_SECRET|RAZORPAY_KEY_SECRET|CASHFREE_SECRET_KEY)/i

export type CheckoutTraceStage =
  | "request"
  | "checkout_session_creation"
  | "checkout_session_lookup"
  | "checkout_session_payment"
  | "customer_lookup"
  | "product_lookup"
  | "plan_lookup"
  | "gateway_lookup"
  | "gateway_credentials"
  | "invoice_creation"
  | "order_creation"
  | "payment_creation"
  | "gateway_order_creation"
  | "transaction_commit"
  | "response"
  | "fatal"
  | string

export function createCheckoutRequestId(prefix = "chk") {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`
}

export function redactCheckoutValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[redacted:depth]"
  if (value == null) return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "string") {
    if (value.length > 4000) return `${value.slice(0, 4000)}…[truncated]`
    return value
  }
  if (typeof value !== "object") return value
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactCheckoutValue(item, depth + 1))
  const output: Record<string, unknown> = {}
  for (const [key, next] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(key)) {
      output[key] = "[redacted]"
    } else {
      output[key] = redactCheckoutValue(next, depth + 1)
    }
  }
  return output
}

export class CheckoutTrace {
  readonly requestId: string
  private readonly startedAt = Date.now()
  private stageStartedAt = Date.now()
  private currentStage: CheckoutTraceStage = "request"

  constructor(requestId = createCheckoutRequestId()) {
    this.requestId = requestId
  }

  start(stage: CheckoutTraceStage, metadata: Record<string, unknown> = {}) {
    this.currentStage = stage
    this.stageStartedAt = Date.now()
    this.log("start", stage, metadata)
  }

  pass(stage: CheckoutTraceStage = this.currentStage, metadata: Record<string, unknown> = {}) {
    this.log("pass", stage, {
      ...metadata,
      stageLatencyMs: Date.now() - this.stageStartedAt,
    })
  }

  fail(stage: CheckoutTraceStage = this.currentStage, error: unknown, metadata: Record<string, unknown> = {}) {
    this.log("fail", stage, {
      ...metadata,
      stageLatencyMs: Date.now() - this.stageStartedAt,
      error: checkoutErrorLogObject(error),
    }, "error")
  }

  info(stage: CheckoutTraceStage, metadata: Record<string, unknown> = {}) {
    this.log("info", stage, metadata)
  }

  private log(event: "start" | "pass" | "fail" | "info", stage: CheckoutTraceStage, metadata: Record<string, unknown>, level: "info" | "warn" | "error" = "info") {
    const payload = redactCheckoutValue({
      requestId: this.requestId,
      event,
      stage,
      totalLatencyMs: Date.now() - this.startedAt,
      ...metadata,
    })
    const label = "[CheckoutPipeline]"
    if (level === "error") console.error(label, payload)
    else if (level === "warn") console.warn(label, payload)
    else console.info(label, payload)
  }
}

export function checkoutErrorLogObject(error: unknown) {
  const anyError = error as any
  return redactCheckoutValue({
    name: anyError?.name || null,
    message: anyError?.message || String(error),
    code: anyError?.code || null,
    meta: anyError?.meta || null,
    clientVersion: anyError?.clientVersion || null,
    sqlState: anyError?.sqlState || anyError?.cause?.code || anyError?.payload?.error?.code || null,
    status: anyError?.status || anyError?.response?.status || null,
    response: anyError?.payload || anyError?.response?.data || null,
    stack: anyError?.stack || null,
  })
}
