import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { createVmAddonPurchaseInvoice, listAvailableVmAddons, removeVmAddon } from "@/lib/vm-addons"
import { requestId, writeStructuredLog } from "@/lib/structured-logger"

export const dynamic = "force-dynamic"

async function customerId() {
  const customer = await getClientFromCookies()
  return String(customer?.sub || "")
}

function clientAddonPlan(plan: any) {
  const { proxmoxNodeId, poolOptions, ...rest } = plan || {}
  return {
    ...rest,
    poolOptions: Array.isArray(poolOptions)
      ? poolOptions.map(({ bridge, ...pool }: any) => pool)
      : [],
  }
}

function clientAddonListing(listing: any) {
  const vps = listing?.vps || {}
  return {
    success: true,
    vps: {
      id: vps.id,
      orderId: vps.orderId || null,
      name: vps.name,
      instanceName: vps.instanceName || null,
      hostname: vps.hostname || null,
      ipAddress: vps.ipAddress || null,
      status: vps.status,
      serviceLocation: vps.serviceLocation || null,
      product: vps.product ? { id: vps.product.id, name: vps.product.name } : null,
    },
    primaryPoolId: listing?.primaryPoolId || null,
    activeAddons: (listing?.activeAddons || []).map(({ metadata, ...addon }: any) => addon),
    plans: (listing?.plans || []).map(clientAddonPlan),
  }
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const customer = await customerId()
  if (!customer) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const listing = await listAvailableVmAddons({ vpsId: id, customerId: customer })
  if (!listing) return NextResponse.json({ success: false, error: "VM not found" }, { status: 404 })
  return NextResponse.json(clientAddonListing(listing), { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now()
  const customer = await customerId()
  if (!customer) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const addonPlanId = String(body.addonPlanId || "").trim()
  const idempotencyKey = String(body.idempotencyKey || request.headers.get("idempotency-key") || "").trim()
  const poolId = body.poolId ? String(body.poolId) : null
  if (!addonPlanId || !idempotencyKey) return NextResponse.json({ success: false, error: "addonPlanId and idempotencyKey are required" }, { status: 400 })
  const reqId = request.headers.get("x-request-id") || requestId("addon")
  try {
    const result = await createVmAddonPurchaseInvoice({ vpsId: id, customerId: customer, addonPlanId, idempotencyKey, poolId, actorEmail: `customer:${customer}`, metadata: { requestId: reqId } })
    await writeStructuredLog("vm-actions", "addon_invoice_created", { requestId: reqId, api: "/api/client/vps/[id]/addons", durationMs: Date.now() - startedAt, result: "created", customerId: customer, vpsInstanceId: id })
    return NextResponse.json({ success: true, ...result, requestId: reqId }, { status: 201 })
  } catch (error: any) {
    await writeStructuredLog("vm-actions", "addon_invoice_failed", { requestId: reqId, api: "/api/client/vps/[id]/addons", durationMs: Date.now() - startedAt, result: "failed", customerId: customer, vpsInstanceId: id, error })
    return NextResponse.json({ success: false, error: error?.message || "Unable to create addon invoice", requestId: reqId }, { status: /not found/i.test(String(error?.message)) ? 404 : 400 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const customer = await customerId()
  if (!customer) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const addonId = String(body.addonId || "").trim()
  if (!addonId) return NextResponse.json({ success: false, error: "addonId is required" }, { status: 400 })
  try {
    const result = await removeVmAddon({ vpsId: id, customerId: customer, addonId, actorEmail: `customer:${customer}` })
    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Unable to remove addon" }, { status: 400 })
  }
}
