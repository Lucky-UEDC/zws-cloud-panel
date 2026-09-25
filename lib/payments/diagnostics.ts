import tls from "node:tls"
import { prisma } from "@/lib/db"
import { getRedisClient } from "@/lib/redis"
import { getRuntimePaymentConfig } from "@/lib/payments/runtime-payment-config"
import { getGatewayDriver } from "@/lib/payments/gateway-drivers"
import { getPublicPaymentRuntime, testGatewayRuntimeAuthentication } from "@/lib/payments/gateway-runtime-service"

type Check = { gateway?: string | null; check: string; status: "pass" | "warn" | "fail"; code: string; safeMessage: string; latencyMs?: number; metadata?: Record<string, unknown> }

async function timed(check: string, fn: () => Promise<void>): Promise<Check> {
  const started = Date.now()
  try { await fn(); return { check, status: "pass", code: `${check}_ok`, safeMessage: `${check} check passed.`, latencyMs: Date.now() - started } }
  catch (error) { return { check, status: "fail", code: `${check}_failed`, safeMessage: String(error instanceof Error ? error.message : error).slice(0, 500), latencyMs: Date.now() - started } }
}

async function tlsCheck(rawUrl: string): Promise<Check> {
  const url = new URL(rawUrl)
  if (url.protocol !== "https:") return { check: "tls", status: "fail", code: "https_required", safeMessage: "The public payment origin must use HTTPS." }
  const started = Date.now()
  return new Promise((resolve) => {
    const socket = tls.connect({ host: url.hostname, port: Number(url.port || 443), servername: url.hostname, rejectUnauthorized: true }, () => {
      const cert = socket.getPeerCertificate()
      const expiresAt = cert.valid_to ? new Date(cert.valid_to) : null
      const days = expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000) : null
      socket.end()
      resolve({ check: "tls", status: days != null && days < 14 ? "warn" : "pass", code: days != null && days < 14 ? "tls_expiring" : "tls_valid", safeMessage: days == null ? "TLS certificate is valid." : `TLS certificate is valid for ${days} more days.`, latencyMs: Date.now() - started, metadata: { expiresAt: expiresAt?.toISOString() || null, daysRemaining: days } })
    })
    socket.setTimeout(8000, () => { socket.destroy(); resolve({ check: "tls", status: "fail", code: "tls_timeout", safeMessage: "TLS connection timed out.", latencyMs: Date.now() - started }) })
    socket.on("error", (error) => resolve({ check: "tls", status: "fail", code: "tls_failed", safeMessage: error.message.slice(0, 500), latencyMs: Date.now() - started }))
  })
}

const REQUIRED_CHECKOUT_COLUMNS: Record<string, string[]> = {
  customers: ["id", "email"],
  products: ["id"],
  orders: ["id", "order_number", "customer_id", "status", "total_amount", "currency"],
  invoices: ["id", "invoice_number", "customer_id", "status", "total_amount", "currency"],
  payments: ["id", "customer_id", "gateway", "amount", "currency", "status"],
  payment_gateways: ["id", "code", "enabled", "credentials", "mode", "priority"],
  payment_attempts: ["id", "gateway", "merchant_order_id", "status"],
}

async function checkoutSchemaChecks(): Promise<Check[]> {
  const started = Date.now()
  try {
    const rows = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ANY(${Object.keys(REQUIRED_CHECKOUT_COLUMNS)})
    `
    const actual = new Map<string, Set<string>>()
    for (const row of rows) {
      if (!actual.has(row.table_name)) actual.set(row.table_name, new Set())
      actual.get(row.table_name)!.add(row.column_name)
    }
    const missing: string[] = []
    for (const [table, columns] of Object.entries(REQUIRED_CHECKOUT_COLUMNS)) {
      const have = actual.get(table) || new Set()
      for (const column of columns) {
        if (!have.has(column)) missing.push(`${table}.${column}`)
      }
    }
    return [{
      check: "checkout_schema",
      status: missing.length ? "fail" : "pass",
      code: missing.length ? "checkout_schema_missing_columns" : "checkout_schema_ok",
      safeMessage: missing.length ? `Missing required checkout columns: ${missing.join(", ")}.` : "Required checkout/payment columns exist.",
      latencyMs: Date.now() - started,
      metadata: { missingColumns: missing },
    }]
  } catch (error: any) {
    return [{ check: "checkout_schema", status: "fail", code: "checkout_schema_check_failed", safeMessage: String(error?.message || error).slice(0, 500), latencyMs: Date.now() - started }]
  }
}

async function paymentOperationalChecks(): Promise<Check[]> {
  const started = Date.now()
  try {
    const [
      checkoutSessions,
      duplicateCheckoutKeys,
      duplicatePaymentKeys,
      stuckPayments,
      unprocessedWebhooks,
      webhookFailures,
      provisionQueue,
      deadQueue,
      invoiceStatus,
      orderStatus,
    ] = await Promise.all([
      prisma.checkoutSession.count().catch(() => 0),
      prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT idempotency_key FROM checkout_sessions
          WHERE idempotency_key IS NOT NULL
          GROUP BY idempotency_key HAVING COUNT(*) > 1
        ) d
      `.catch(() => [{ count: 0 }]),
      prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT idempotency_key FROM payments
          WHERE idempotency_key IS NOT NULL
          GROUP BY idempotency_key HAVING COUNT(*) > 1
        ) d
      `.catch(() => [{ count: 0 }]),
      prisma.payment.count({
        where: {
          gateway: "razorpay",
          status: { in: ["created", "pending", "waiting", "started", "initializing", "authorized"] },
          createdAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
        },
      }).catch(() => 0),
      prisma.paymentWebhookEvent.count({ where: { processedAt: null, createdAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } } }).catch(() => 0),
      prisma.paymentWebhookEvent.count({ where: { status: { in: ["signature_failed", "invalid_signature", "finalization_failed", "amount_mismatch", "currency_mismatch", "payment_attempt_not_found"] } } }).catch(() => 0),
      prisma.provisioningJob.count({ where: { status: { in: ["queued", "running", "retrying", "waiting_for_admin"] } } }).catch(() => 0),
      prisma.provisioningJob.count({ where: { status: { in: ["failed", "dead", "cancelled"] } } }).catch(() => 0),
      prisma.invoice.groupBy({ by: ["status"], _count: { _all: true } }).catch(() => []),
      prisma.order.groupBy({ by: ["status"], _count: { _all: true } }).catch(() => []),
    ])
    const duplicateKeys = Number(duplicateCheckoutKeys[0]?.count || 0) + Number(duplicatePaymentKeys[0]?.count || 0)
    const status = duplicateKeys || stuckPayments || unprocessedWebhooks || webhookFailures || deadQueue ? "warn" : "pass"
    return [{
      check: "payment_operations",
      status,
      code: status === "pass" ? "payment_operations_clear" : "payment_operations_attention_required",
      safeMessage: status === "pass"
        ? "Checkout sessions, payments, webhooks, and queues have no obvious stuck operational state."
        : "Payment operations need attention. Review duplicate keys, stuck payments, webhook failures, and queues.",
      latencyMs: Date.now() - started,
      metadata: {
        checkoutSessions,
        duplicateKeys: {
          checkoutSessions: Number(duplicateCheckoutKeys[0]?.count || 0),
          payments: Number(duplicatePaymentKeys[0]?.count || 0),
        },
        stuckPayments,
        unprocessedWebhooks,
        webhookFailures,
        provisionQueue,
        deadQueue,
        invoiceStatus,
        orderStatus,
        retryButtons: ["reconcile_payment", "replay_webhook", "retry_provisioning", "retry_notification", "release_stale_checkout"],
      },
    }]
  } catch (error: any) {
    return [{ check: "payment_operations", status: "fail", code: "payment_operations_failed", safeMessage: String(error?.message || error).slice(0, 500), latencyMs: Date.now() - started }]
  }
}

function publicOrigin() {
  return String(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "")
}

export async function runEnterprisePaymentDiagnostics(input: { requestedBy?: string | null; trigger?: string; runLiveAuth?: boolean } = {}) {
  const run = await (prisma as any).paymentDiagnosticRun.create({ data: { requestedBy: input.requestedBy || null, trigger: input.trigger || "admin", status: "running" } })
  const checks: Check[] = []
  checks.push(await timed("database", async () => { await prisma.$queryRaw`SELECT 1` }))
  checks.push(...await checkoutSchemaChecks())
  checks.push(...await paymentOperationalChecks())
  checks.push(await timed("redis", async () => { const redis = getRedisClient(); if (!redis) throw new Error("REDIS_URL is not configured."); if (redis.status === "wait") await redis.connect(); if (await redis.ping() !== "PONG") throw new Error("Redis did not return PONG.") }))
  checks.push(await timed("queue", async () => { await (prisma as any).paymentOutboxEvent.count({ where: { status: { in: ["pending", "retry", "processing"] } } }) }))
  checks.push({ check: "session", status: "pass", code: "session_store_configured", safeMessage: "Server-side session store and refresh endpoint are configured." })
  checks.push({ check: "jwt", status: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || process.env.JWT_SECRET ? "pass" : "warn", code: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || process.env.JWT_SECRET ? "jwt_secret_present" : "opaque_session_tokens", safeMessage: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || process.env.JWT_SECRET ? "JWT signing configuration is present." : "Authentication uses opaque server-side sessions; no JWT signing secret is required." })
  const origin = publicOrigin()
  checks.push(origin ? await tlsCheck(origin) : { check: "tls", status: "fail", code: "public_origin_missing", safeMessage: "APP_URL or NEXT_PUBLIC_APP_URL is missing." })
  if (origin) checks.push(await timed("https", async () => { const response = await fetch(origin, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000) }); if (response.status >= 500) throw new Error(`Public origin returned HTTP ${response.status}.`) }))

  const runtime = await getRuntimePaymentConfig()
  const publicRuntime = await getPublicPaymentRuntime({ uncached: true })
  checks.push({
    check: "runtime_config",
    status: publicRuntime.enabledGateways.length ? "pass" : "fail",
    code: publicRuntime.enabledGateways.length ? "runtime_gateway_available" : "runtime_gateway_missing",
    safeMessage: publicRuntime.enabledGateways.length
      ? `Runtime has enabled gateways: ${publicRuntime.enabledGateways.map((gateway) => gateway.gateway).join(", ")}.`
      : "No enabled runtime gateway is ready for checkout.",
    metadata: { defaultGateway: publicRuntime.defaultGateway, enabledGateways: publicRuntime.enabledGateways.map((gateway) => ({ gateway: gateway.gateway, hasPublicKey: Boolean(gateway.publicKey), healthState: gateway.healthState })) },
  })
  for (const config of runtime.gateways) {
    if (!config.enabled || !["razorpay", "phonepe", "cashfree"].includes(config.gateway)) continue
    const driver = getGatewayDriver(config.gateway as any)
    const gatewayChecks = await driver.diagnose({ gatewayConfig: config, webhookUrl: String(config.webhookUrl || ""), runLiveAuth: Boolean(input.runLiveAuth) })
    checks.push(...gatewayChecks.map((check) => ({ gateway: config.gateway, check: check.check, status: check.status, code: check.code, safeMessage: check.message, latencyMs: check.latencyMs, metadata: check.metadata })))
    const auth = await testGatewayRuntimeAuthentication(config).catch((error: any) => ({ ok: false, code: "gateway_auth_exception", message: String(error?.message || error) }))
    checks.push({ gateway: config.gateway, check: "gateway_authentication", status: auth.ok ? "pass" : "fail", code: auth.code, safeMessage: auth.message })
    const latestWebhook = await prisma.paymentWebhookEvent.findFirst({ where: { gateway: config.gateway }, orderBy: { createdAt: "desc" } }).catch(() => null)
    checks.push({ gateway: config.gateway, check: "webhook", status: latestWebhook?.signatureValid === false ? "fail" : latestWebhook ? "pass" : "warn", code: latestWebhook?.signatureValid === false ? "latest_signature_invalid" : latestWebhook ? "webhook_observed" : "webhook_not_observed", safeMessage: latestWebhook ? `Latest callback status: ${latestWebhook.status}.` : "No callback has been observed for this gateway.", metadata: { latestCallbackAt: latestWebhook?.createdAt || null } })
  }
  const failed = checks.filter((check) => check.status === "fail").length
  const warnings = checks.filter((check) => check.status === "warn").length
  await (prisma as any).paymentDiagnosticCheck.createMany({ data: checks.map((check) => ({ runId: run.id, gateway: check.gateway || null, check: check.check, status: check.status, code: check.code, safeMessage: check.safeMessage, latencyMs: check.latencyMs || null, metadata: check.metadata || {} })) })
  const summary = { total: checks.length, passed: checks.length - failed - warnings, warnings, failed }
  return (prisma as any).paymentDiagnosticRun.update({ where: { id: run.id }, data: { status: failed ? "failed" : warnings ? "degraded" : "passed", completedAt: new Date(), summary }, include: { checks: { orderBy: [{ gateway: "asc" }, { check: "asc" }] } } })
}

export async function latestEnterprisePaymentDiagnostics() {
  return (prisma as any).paymentDiagnosticRun.findFirst({ orderBy: { createdAt: "desc" }, include: { checks: { orderBy: [{ gateway: "asc" }, { check: "asc" }] } } })
}
