import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { getSnapshotServiceSettings, getPaymentSettings } from "@/lib/settings"
import { listSnapshotsForVm, snapshotCapabilitySummary } from "@/lib/proxmox-snapshots"
import { createSnapshotChargeOrder } from "@/lib/billing/billable-orders"
import { calculateSnapshotQuote, creditCoversTotal } from "@/lib/billing/snapshot-pricing"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

async function resolveSnapshotPrice(input: {
  vpsInstanceId: string
  nodeId: string
  vmid: number
  settings: Awaited<ReturnType<typeof getSnapshotServiceSettings>> | null
}) {
  const settings = input.settings
  const paymentSettings = await getPaymentSettings().catch(() => null)
  const gstRate = Number(paymentSettings?.gstRate ?? 18)
  if (String(settings?.model || "per_snapshot") === "plan") {
    const plan = await prisma.snapshotPlan.findFirst({ where: { active: true, archived: false }, orderBy: { createdAt: "asc" } })
    if (plan) {
      const views = await listSnapshotsForVm(input.nodeId, input.vmid).catch(() => [])
      const count = views.filter((view) => view.name !== "current").length
      const included = Number(plan.includedSnapshots || 0)
      if (count < included) return { amount: 0, taxPercent: Number(plan.taxPercent || gstRate), planId: plan.id, planName: plan.name, included }
      return { amount: Number(plan.overageSnapshotPrice || plan.price || 0), taxPercent: Number(plan.taxPercent || gstRate), planId: plan.id, planName: plan.name, included }
    }
  }
  const perSnapshotPrice = Number(settings?.perSnapshotPrice ?? 20)
  return { amount: perSnapshotPrice, taxPercent: gstRate, planId: null, planName: null, included: 0 }
}

export async function GET(request: NextRequest) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })

  const url = new URL(request.url)
  const orderId = String(url.searchParams.get("orderId") || "")
  if (!orderId) return NextResponse.json({ success: false, error: "orderId is required" }, { status: 400, headers: NO_CACHE_HEADERS })

  const order = await prisma.order.findUnique({ where: { id: orderId } }).catch(() => null)
  if (!order || order.customerId !== customerId) return NextResponse.json({ success: false, error: "Purchase not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  const charge = await prisma.snapshotCharge.findFirst({ where: { customerId, orderId }, orderBy: { createdAt: "desc" } }).catch(() => null)
  const metadata = record(order.metadata)
  const operationId = charge ? String(record(charge.metadata).operationId || "") || null : null

  return NextResponse.json({
    success: true,
    status: order.status,
    charge: charge
      ? { id: charge.id, status: charge.status, amount: Number(charge.amount), taxAmount: Number(charge.taxAmount), totalAmount: Number(charge.totalAmount), snapshotName: charge.snapshotName, snapshotId: charge.snapshotId, operationId }
      : null,
    snapshotIntent: metadata.snapshotIntent || null,
    operationId,
  }, { headers: NO_CACHE_HEADERS })
}

export async function POST(request: NextRequest) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })

  const body = await request.json().catch(() => ({}))
  const vpsInstanceId = String(body.vpsInstanceId || "")
  const name = String(body.name || "").trim()
  const description = String(body.description || "").trim() || undefined
  const vmstate = Boolean(body.vmstate)

  if (!vpsInstanceId || !name) return NextResponse.json({ error: "vpsInstanceId and name are required" }, { status: 400, headers: NO_CACHE_HEADERS })
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) return NextResponse.json({ error: "Snapshot name may only contain letters, digits, dots, underscores and dashes (max 64)" }, { status: 400, headers: NO_CACHE_HEADERS })

  const instance = await prisma.vpsInstance.findFirst({
    where: { id: vpsInstanceId, customerId, deletedAt: null },
    include: { proxmoxNode: { select: { nodeName: true } } },
  })
  if (!instance || !instance.vmid || !instance.proxmoxNodeId) return NextResponse.json({ error: "Server not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  const settings = await getSnapshotServiceSettings().catch(() => null)
  const serviceEnabled = Boolean(settings?.enabled ?? true)
  if (!serviceEnabled) return NextResponse.json({ success: false, error: "Snapshot service is not available for this account." }, { status: 403, headers: NO_CACHE_HEADERS })

  const supportIssue = await snapshotCapabilitySummary(instance.proxmoxNodeId, Number(instance.vmid)).catch(() => null)
  if (supportIssue && !supportIssue.capable) {
    return NextResponse.json({ success: false, error: supportIssue.reason || "Snapshots are not available for this server's storage configuration." }, { status: 409, headers: NO_CACHE_HEADERS })
  }

  const maxSnapshots = Number(settings?.maxSnapshots || 0)
  if (maxSnapshots > 0) {
    const views = await listSnapshotsForVm(instance.proxmoxNodeId, Number(instance.vmid)).catch(() => [])
    const count = views.filter((view) => view.name !== "current").length
    if (count >= maxSnapshots) {
      return NextResponse.json({ success: false, error: `Snapshot limit reached (${maxSnapshots}). Delete an existing snapshot before creating another.` }, { status: 409, headers: NO_CACHE_HEADERS })
    }
  }

  const pricing = await resolveSnapshotPrice({ vpsInstanceId: instance.id, nodeId: instance.proxmoxNodeId, vmid: Number(instance.vmid), settings })

  if (pricing.amount <= 0) {
    const { runOperationBackground } = await import("@/lib/operation-progress")
    const { createVmSnapshot } = await import("@/lib/proxmox-snapshots")
    const { randomUUID } = await import("crypto")
    const operationId = randomUUID()
    runOperationBackground({
      operationId,
      kind: "snapshot",
      vpsInstanceId: instance.id,
      customerId,
      vmId: Number(instance.vmid),
      headline: `Creating snapshot "${name}"`,
      nodeName: instance.proxmoxNode?.nodeName || undefined,
      run: async (report) => {
        report({ phase: "Creating snapshot", status: "running" as const })
        const result = await createVmSnapshot({ nodeId: instance.proxmoxNodeId!, vmid: Number(instance.vmid), name, description, vmstate, actor: "client" })
        report({ phase: "Snapshot created", status: "completed" as const, result: { snapshot: result.snapshot } })
      },
    })
    return NextResponse.json({ success: true, free: true, operationId, snapshot: { name, vmstate } }, { headers: NO_CACHE_HEADERS })
  }

  const quote = calculateSnapshotQuote({ baseAmount: pricing.amount, taxPercent: pricing.taxPercent })
  const total = quote.total

  const existing = await prisma.snapshotCharge.findFirst({
    where: { customerId, vpsInstanceId: instance.id, snapshotName: name, status: "unpaid", orderId: { not: null } },
    orderBy: { createdAt: "desc" },
  })
  let order
  let chargeId
  if (existing?.orderId) {
    order = await prisma.order.findUnique({ where: { id: existing.orderId } })
    chargeId = existing.id
  } else {
    const created = await createSnapshotChargeOrder({
      customerId,
      vpsInstanceId: instance.id,
      name,
      description,
      vmstate,
      nodeId: instance.proxmoxNodeId,
      vmid: Number(instance.vmid),
      amount: quote.subtotal,
      taxAmount: quote.gst,
      totalAmount: total,
      gstRate: quote.taxPercent,
    })
    order = created.order
    chargeId = created.chargeId
  }

  const wallet = await prisma.customer.findUnique({ where: { id: customerId }, select: { walletBalance: true } })
  const walletBalance = Number(wallet?.walletBalance || 0)

  const availability = supportIssue
    ? { capable: supportIssue.capable, storage: supportIssue.storage, type: supportIssue.type }
    : { capable: null, storage: null, type: null }

  return NextResponse.json({
    success: true,
    purchaseRequired: true,
    orderId: order?.id || null,
    chargeId,
    snapshot: { name, vmstate },
    quote: { subtotal: quote.subtotal, taxAmount: quote.gst, taxPercent: quote.taxPercent, total },
    wallet: { balance: walletBalance, sufficient: creditCoversTotal(walletBalance, total) },
    availability,
    idempotencyKey: order ? `billable:${order.id}` : null,
    planName: pricing.planName,
    billing: { enabled: true, model: String(settings?.model || "per_snapshot") },
  }, { headers: NO_CACHE_HEADERS })
}