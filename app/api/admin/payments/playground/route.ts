import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { getBaseUrl } from "@/lib/runtime-site-url"
import { getUsableGateways } from "@/lib/runtime-payment-resolver"
import { validateAdminPaymentGateway } from "@/lib/payments/payment-gateway-admin-service"

const actions = new Set([
  "load_gateway",
  "validate_gateway",
  "generate_order",
  "generate_invoice",
  "create_razorpay_order",
  "create_checkout_session",
  "open_checkout",
  "webhook_simulator",
  "refund_simulator",
])

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      /secret|password|token|signature|keySecret/i.test(key) ? "[redacted]" : redact(item),
    ]))
  }
  return value
}

async function recordStep(input: {
  runId: string
  action: string
  gateway?: string | null
  status: "pass" | "fail"
  code: string
  message: string
  latencyMs: number
  metadata: Record<string, unknown>
}) {
  return (prisma as any).paymentDiagnosticCheck.create({
    data: {
      runId: input.runId,
      gateway: input.gateway || null,
      check: input.action,
      status: input.status,
      code: input.code,
      safeMessage: input.message,
      latencyMs: input.latencyMs,
      metadata: redact(input.metadata) as any,
    },
  })
}

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ ok: false, code: "unauthorized", message: "Unauthorized" }, { status: 401 })
  }
  const runs = await (prisma as any).paymentDiagnosticRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { checks: { orderBy: { createdAt: "asc" } } },
  }).catch(() => [])
  return NextResponse.json({ ok: true, runs }, { headers: { "cache-control": "no-store" } })
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ ok: false, code: "unauthorized", message: "Unauthorized" }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const action = String(body.action || "").trim()
  if (!actions.has(action)) {
    return NextResponse.json({ ok: false, code: "playground_action_invalid", message: "Unsupported playground action." }, { status: 400 })
  }
  const startedAt = Date.now()
  const run = await (prisma as any).paymentDiagnosticRun.create({
    data: { trigger: `playground:${action}`, requestedBy: admin.email, status: "running", summary: { action } },
  })
  try {
    const gateways = await getUsableGateways({ request })
    const selected = gateways[0] || null
    let code = selected ? "playground_step_passed" : "gateway_unavailable"
    let message = selected ? "Playground step passed." : "No valid runtime gateway is available."
    let metadata: Record<string, unknown> = { action, selectedGateway: selected ? { gateway: selected.gateway, id: selected.paymentGatewayId, priority: selected.priority } : null }
    let status: "pass" | "fail" = selected ? "pass" : "fail"

    if (action === "load_gateway") {
      metadata.gateways = gateways.map((gateway) => ({ gateway: gateway.gateway, id: gateway.paymentGatewayId, priority: gateway.priority }))
      message = selected ? `Loaded ${selected.gateway}.` : message
    } else if (action === "validate_gateway") {
      const row = selected ? await (prisma as any).paymentGateway.findUnique({ where: { id: selected.paymentGatewayId } }).catch(() => null) : null
      const validation = row ? await validateAdminPaymentGateway(row, request, { requireAuth: true }) : null
      status = validation?.ok ? "pass" : "fail"
      code = validation?.ok ? validation.validation.code : validation?.error.code || "gateway_unavailable"
      message = validation?.ok ? validation.message : validation?.error.message || message
      metadata.validation = validation
    } else if (action === "generate_order") {
      metadata.generatedOrder = { diagnosticOnly: true, referenceId: `PG-ORDER-${Date.now().toString(36).toUpperCase()}` }
      message = "Generated diagnostic order payload."
    } else if (action === "generate_invoice") {
      metadata.generatedInvoice = { diagnosticOnly: true, invoiceNumber: `PG-INV-${Date.now().toString(36).toUpperCase()}`, amount: 1, currency: "INR" }
      message = "Generated diagnostic invoice payload."
    } else if (action === "create_razorpay_order") {
      status = selected?.gateway === "razorpay" ? "pass" : "fail"
      code = selected?.gateway === "razorpay" ? "razorpay_order_diagnostic_ready" : "razorpay_not_selected"
      message = selected?.gateway === "razorpay" ? "Razorpay is selected for diagnostic one-time order creation." : "Razorpay is not the selected runtime gateway."
      metadata.razorpay = { diagnosticOnly: true, liveNetworkMutation: false }
    } else if (action === "create_checkout_session" || action === "open_checkout") {
      metadata.checkout = { diagnosticOnly: true, endpoint: "/api/payments/create", requiresCustomerSession: true }
      message = action === "open_checkout" ? "Checkout open step is ready; real customer session is required." : "Checkout session diagnostic is ready."
    } else if (action === "webhook_simulator") {
      metadata.webhook = { diagnosticOnly: true, signedDiagnosticPayload: true, canMarkInvoicePaid: false }
      message = "Webhook simulator is isolated and cannot mark customer invoices paid."
    } else if (action === "refund_simulator") {
      metadata.refund = { diagnosticOnly: true, canIssueRealRefund: false }
      message = "Refund simulator is isolated and cannot issue real refunds."
    }

    const check = await recordStep({ runId: run.id, action, gateway: selected?.gateway || null, status, code, message, latencyMs: Date.now() - startedAt, metadata })
    await (prisma as any).paymentDiagnosticRun.update({
      where: { id: run.id },
      data: { status: status === "pass" ? "passed" : "failed", completedAt: new Date(), summary: { action, status, code, message } },
    }).catch(() => null)
    return NextResponse.json({ ok: status === "pass", runId: run.id, step: check, status, code, message, metadata: redact(metadata) }, { status: status === "pass" ? 200 : 400, headers: { "cache-control": "no-store" } })
  } catch (error: any) {
    const message = error?.message || "Payment playground step failed."
    const check = await recordStep({
      runId: run.id,
      action,
      status: "fail",
      code: error?.code || "playground_step_failed",
      message,
      latencyMs: Date.now() - startedAt,
      metadata: { stack: String(error?.stack || "").split("\n").slice(0, 8).join("\n") },
    }).catch(() => null)
    await (prisma as any).paymentDiagnosticRun.update({
      where: { id: run.id },
      data: { status: "failed", completedAt: new Date(), summary: { action, status: "fail", code: error?.code || "playground_step_failed", message } },
    }).catch(() => null)
    return NextResponse.json({ ok: false, runId: run.id, step: check, code: error?.code || "playground_step_failed", message }, { status: 500 })
  }
}
