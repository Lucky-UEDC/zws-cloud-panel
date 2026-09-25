import { prisma } from "@/lib/db"
import { loadRuntimePaymentConfig, revalidatePaymentGateways } from "@/lib/payments/runtime-payment-config"
import { repairStuckCashfreePayments } from "@/lib/payment-repair"

function webhookUrlFor(gateway: string) {
  return `/api/webhooks/${gateway}`
}

function missingWebhook(url: string | null | undefined, gateway: string) {
  const text = String(url || "")
  return !text || !text.includes(webhookUrlFor(gateway)) || (text.startsWith("http://") && process.env.NODE_ENV === "production")
}

async function updateGatewayHealth(gateway: string, status: string, safeMessage: string, metadata: Record<string, unknown>) {
  await prisma.gatewayHealthLog.create({
    data: {
      gateway,
      status,
      safeMessage,
      metadata: metadata as any,
      checkedUrl: typeof metadata.webhookUrl === "string" ? metadata.webhookUrl : null,
    },
  }).catch(() => null)
  const rows = await (prisma as any).paymentGateway.findMany({ where: { OR: [{ code: gateway }, { provider: gateway }] } }).catch(() => [])
  for (const row of rows) {
    const failed = !["healthy", "disabled"].includes(status)
    const failures = failed ? Number(row.consecutiveFailures || 0) + 1 : 0
    const nextStatus = row.enabled === false ? "disabled" : failures >= 3 ? "open" : status === "healthy" && row.lastHealthStatus === "open" ? "recovering" : status
    await (prisma as any).paymentGateway.update({ where: { id: row.id }, data: { lastHealthStatus: nextStatus, consecutiveFailures: failures, circuitOpenedAt: nextStatus === "open" ? row.circuitOpenedAt || new Date() : nextStatus === "healthy" ? null : row.circuitOpenedAt, lastHealthCheckedAt: new Date(), lastError: nextStatus === "healthy" ? null : safeMessage.slice(0, 500) } }).catch(() => null)
  }
}

export async function runPaymentGatewayHealthCheck() {
  revalidatePaymentGateways()
  const runtime = await loadRuntimePaymentConfig()
  const checkedAt = new Date()
  for (const gateway of runtime.gateways) {
    if (!gateway.enabled) {
      await updateGatewayHealth(gateway.gateway, "disabled", "Gateway is disabled.", { checkedAt: checkedAt.toISOString() })
      continue
    }
    if (gateway.missingFields.length > 0) {
      await updateGatewayHealth(gateway.gateway, "degraded", "Gateway credentials are incomplete.", {
        checkedAt: checkedAt.toISOString(),
        missingFields: gateway.missingFields,
      })
      continue
    }
    if (missingWebhook(gateway.webhookUrl, gateway.gateway)) {
      await updateGatewayHealth(gateway.gateway, "degraded", "Webhook URL is missing or does not match the required runtime endpoint.", {
        checkedAt: checkedAt.toISOString(),
        webhookUrl: gateway.webhookUrl || null,
        requiredPath: webhookUrlFor(gateway.gateway),
      })
      continue
    }
    const latestWebhook = await prisma.paymentWebhookEvent.findFirst({
      where: { gateway: gateway.gateway },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, status: true },
    }).catch(() => null)
    await updateGatewayHealth(gateway.gateway, "healthy", "Gateway runtime configuration is valid.", {
      checkedAt: checkedAt.toISOString(),
      webhookUrl: gateway.webhookUrl || null,
      latestWebhookAt: latestWebhook?.createdAt?.toISOString?.() || null,
      latestWebhookStatus: latestWebhook?.status || null,
    })
  }

  const repair = await repairStuckCashfreePayments({
    actor: "worker:payment-health",
    limit: 100,
    dryRun: false,
  }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))

  return {
    checkedAt: checkedAt.toISOString(),
    gateways: runtime.gateways.length,
    repair,
  }
}
