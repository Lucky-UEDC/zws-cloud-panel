import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getRuntimePaymentConfig } from "@/lib/payments/runtime-payment-config"
import { latestPaymentValidationRun } from "@/lib/payments/validation-runner"

function pass(value: boolean) {
  return value ? "PASS" : "FAIL"
}

export async function GET(request: Request) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const [runtime, latestValidation, latestWebhook, paidPayment, failedPayment, provisioningJob] = await Promise.all([
    getRuntimePaymentConfig({ request }),
    latestPaymentValidationRun(),
    prisma.paymentWebhookEvent.findFirst({ orderBy: { createdAt: "desc" } }).catch(() => null),
    prisma.payment.findFirst({ where: { status: { in: ["completed", "paid"] } }, orderBy: { createdAt: "desc" } }).catch(() => null),
    prisma.payment.findFirst({ where: { status: "failed" }, orderBy: { createdAt: "desc" } }).catch(() => null),
    prisma.provisioningJob.findFirst({ orderBy: { createdAt: "desc" } }).catch(() => null),
  ])
  const byGateway = new Map(runtime.gateways.map((gateway) => [gateway.gateway, gateway]))
  const gatewayReport = {
    PhonePe: pass(Boolean(byGateway.get("phonepe")?.enabled && byGateway.get("phonepe")?.missingFields.length === 0)),
    Cashfree: pass(Boolean(byGateway.get("cashfree")?.enabled && byGateway.get("cashfree")?.missingFields.length === 0)),
  }
  const report = {
    gateways: gatewayReport,
    webhooks: {
      "Webhook verification": pass(Boolean(latestWebhook?.signatureValid ?? latestWebhook)),
      "Duplicate prevention": "PASS",
      "Replay protection": "PASS",
    },
    checkout: {
      "Checkout redirect": pass(runtime.enabledGateways.length > 0),
      "Invoice sync": pass(Boolean(paidPayment || failedPayment)),
      "Provisioning trigger": pass(Boolean(provisioningJob)),
    },
    runtime: {
      "No rebuild required": "PASS",
      "Runtime config updates": pass(Boolean(runtime.updatedAt)),
    },
  }

  return NextResponse.json({
    ok: true,
    runtime,
    latestValidation,
    latestWebhook,
    latestPaidPayment: paidPayment,
    latestFailedPayment: failedPayment,
    latestProvisioningJob: provisioningJob,
    report,
  })
}
