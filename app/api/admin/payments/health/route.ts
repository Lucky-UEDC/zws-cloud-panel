import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { getBaseUrl } from "@/lib/runtime-site-url"
import { validateGatewayRow } from "@/lib/payments/gateway-registry"
import { credentialsSnapshot } from "@/lib/payments/payment-gateway-admin-service"

function isPending(value: string | null | undefined) {
  const status = String(value || "").toLowerCase()
  return ["pending", "created", "initiated", "waiting", "started", "processing", "verification_pending"].includes(status)
}

export async function GET(request: Request) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const [
    pendingInvoices,
    failedWebhooks,
    signatureFailures,
    pendingPayments,
    stuckPayments,
    failedProvisioningTriggers,
    failedWalletCredits,
    lastWebhook,
    recentWebhookEvents,
    gateways,
    latestValidationRuns,
    latestHealthLogs,
    latestPayments,
  ] = await Promise.all([
    prisma.invoice.count({ where: { status: "pending" } }),
    prisma.paymentWebhookEvent.count({ where: { status: { in: ["signature_failed", "gateway_config_missing", "invalid_payload", "invalid_shape"] } } }),
    prisma.paymentWebhookEvent.count({ where: { status: "signature_failed" } }),
    prisma.payment.count({ where: { status: { in: ["pending", "created", "initiated", "waiting", "started", "verification_pending"] } } }),
    prisma.payment.count({ where: { status: "pending", updatedAt: { lt: new Date(Date.now() - 20 * 60 * 1000) } } }),
    prisma.order.count({ where: { status: { in: ["paid", "payment_verified"] }, provisioningStatus: { in: ["pending", "failed", "WAITING_FOR_ADMIN", "FAILED"] } } }),
    prisma.invoice.count({
      where: {
        status: "paid",
        payments: {
          some: {
            purpose: { in: ["wallet_topup", "topup"] },
            status: { in: ["completed", "paid", "success", "verification_pending"] },
            paymentAttempts: {
              some: {
                walletTransactions: {
                  none: {},
                },
              },
            },
          },
        },
      },
    }),
    prisma.paymentWebhookEvent.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.paymentWebhookEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    (prisma as any).paymentGateway.findMany({ orderBy: [{ priority: "asc" }, { id: "asc" }] }).catch(() => []),
    (prisma as any).paymentValidationRun.findMany({ orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []),
    (prisma as any).gatewayHealthLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []),
    prisma.payment.findMany({ orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []),
  ])

  const processedEvents = recentWebhookEvents.filter((row) => !isPending(row.status))
  const avgLatencyMs = processedEvents.length
    ? Math.round(
        processedEvents.reduce((sum, row) => {
          const end = row.processedAt ? row.processedAt.getTime() : row.updatedAt.getTime()
          return sum + Math.max(0, end - row.createdAt.getTime())
        }, 0) / processedEvents.length,
      )
    : 0

  const retries = recentWebhookEvents.filter((row) => String(row.status || "").toLowerCase().includes("duplicate")).length

  const baseUrl = getBaseUrl(request)
  const gatewayRows = gateways.map((gateway: any) => {
    const provider = String(gateway.code || gateway.provider || "").toLowerCase()
    const validation = validateGatewayRow(gateway, baseUrl)
    const latestValidation = latestValidationRuns.find((run: any) => String(run.gateway || "").toLowerCase() === provider)
    const latestHealth = latestHealthLogs.find((log: any) => String(log.gateway || "").toLowerCase() === provider)
    const latestPayment = latestPayments.find((payment: any) => String(payment.gateway || "").toLowerCase() === provider)
    return {
      id: gateway.id,
      gateway: provider,
      enabled: Boolean(gateway.enabled ?? gateway.active),
      priority: Number(gateway.priority || 100),
      credentials: credentialsSnapshot(gateway),
      runtime: {
        ok: validation.ok,
        code: validation.code,
        reason: validation.reason,
        missingFields: [...validation.missingFields, ...validation.webhookMissingFields],
      },
      webhook: {
        url: validation.webhookUrl,
        configured: validation.webhookMissingFields.length === 0 && validation.webhookUrlValid,
        lastStatus: gateway.lastWebhookStatus || null,
      },
      lastPayment: latestPayment ? {
        id: latestPayment.id,
        status: latestPayment.status,
        amount: latestPayment.amount,
        currency: latestPayment.currency,
        createdAt: latestPayment.createdAt,
      } : null,
      lastError: gateway.lastError || null,
      lastValidation: latestValidation ? {
        id: latestValidation.id,
        status: latestValidation.status,
        errorMessage: latestValidation.errorMessage || null,
        createdAt: latestValidation.createdAt,
      } : null,
      apiLatency: latestHealth?.latencyMs ?? null,
      lastHealth: latestHealth ? {
        status: latestHealth.status,
        safeMessage: latestHealth.safeMessage,
        createdAt: latestHealth.createdAt,
      } : null,
    }
  })

  return NextResponse.json({
    success: true,
    cards: {
      pendingInvoices,
      failedWebhooks,
      signatureFailures,
      pendingPayments,
      stuckPayments,
      failedProvisioningTriggers,
      failedWalletCredits,
      webhookRetries: retries,
      webhookLatencyMs: avgLatencyMs,
      lastWebhookAt: lastWebhook?.createdAt || null,
    },
    gateways: gatewayRows,
    latestEvents: recentWebhookEvents.slice(0, 20),
  }, { headers: { "cache-control": "no-store" } })
}
