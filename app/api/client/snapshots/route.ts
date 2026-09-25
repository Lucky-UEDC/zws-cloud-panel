import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { createVmSnapshot, listSnapshotsForVm, snapshotCapabilitySummary } from "@/lib/proxmox-snapshots"
import { runOperationBackground } from "@/lib/operation-progress"
import { getSnapshotServiceSettings, getPaymentSettings } from "@/lib/settings"
import { randomUUID } from "crypto"
import { calculateSnapshotQuote } from "@/lib/billing/snapshot-pricing"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function GET(request: NextRequest) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })

  const url = new URL(request.url)
  const vmIdParam = url.searchParams.get("vmId")
  const instances = await prisma.vpsInstance.findMany({
    where: { customerId, deletedAt: null, vmid: { gt: 0 } },
    include: { proxmoxNode: { select: { nodeName: true, host: true, status: true } } },
    orderBy: { vmid: "asc" },
  })

  const [settings, paymentSettings] = await Promise.all([
    getSnapshotServiceSettings().catch(() => null),
    getPaymentSettings().catch(() => null),
  ])
  const gstRate = Number(paymentSettings?.gstRate ?? 18)
  const perSnapshotPrice = Number(settings?.perSnapshotPrice ?? 20)
  const service = {
    enabled: Boolean(settings?.enabled ?? true),
    model: String(settings?.model || "per_snapshot"),
    perSnapshotPrice,
    taxPercent: gstRate,
    pricePreview: calculateSnapshotQuote({ baseAmount: perSnapshotPrice, taxPercent: gstRate }),
  }

  const vms = instances.map((instance) => ({
    vmId: Number(instance.vmid),
    vpsInstanceId: instance.id,
    name: instance.instanceName || instance.hostname || instance.name || `VM-${instance.vmid}`,
    status: instance.status,
  }))

  const filtered = vmIdParam ? instances.filter((instance) => String(instance.vmid) === String(vmIdParam)) : instances
  const snapshots = []

  for (const instance of filtered) {
    if (!instance.proxmoxNodeId || !instance.proxmoxNode) {
      snapshots.push({ vmId: Number(instance.vmid), vpsInstanceId: instance.id, name: instance.instanceName || instance.name, items: [], unreachable: "No node assigned", error: null, capable: null })
      continue
    }
    try {
      const views = await listSnapshotsForVm(instance.proxmoxNodeId, Number(instance.vmid))
      const capability = await snapshotCapabilitySummary(instance.proxmoxNodeId, Number(instance.vmid)).catch(() => null)
      snapshots.push({
        vmId: Number(instance.vmid),
        vpsInstanceId: instance.id,
        name: instance.instanceName || instance.name,
        items: views.map((view) => ({
          name: String(view.name),
          description: view.description || null,
          vmstate: Boolean(view.vmstate),
          current: Boolean(view.current),
          parent: view.parent || null,
          created: view.created,
          sizeBytes: view.sizeBytes != null ? String(view.sizeBytes) : null,
        })),
        unreachable: null,
        error: null,
        capable: capability ? { capable: capability.capable, storage: capability.storage, type: capability.type } : null,
      })
    } catch (error: any) {
      snapshots.push({
        vmId: Number(instance.vmid),
        vpsInstanceId: instance.id,
        name: instance.instanceName || instance.name,
        items: [],
        unreachable: null,
        error: String(error?.message || "Failed to load snapshots"),
        capable: null,
      })
    }
  }

  return NextResponse.json({ success: true, service, vms, snapshots }, { headers: NO_CACHE_HEADERS })
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

  const supportIssue = await snapshotCapabilitySummary(instance.proxmoxNodeId, Number(instance.vmid)).catch(() => null)
  if (supportIssue && !supportIssue.capable) {
    return NextResponse.json({ success: false, error: supportIssue.reason || "Snapshots are not available for this server's storage configuration." }, { status: 409, headers: NO_CACHE_HEADERS })
  }

  const settings = await getSnapshotServiceSettings().catch(() => null)
  if (!settings?.enabled) {
    return NextResponse.json({ success: false, error: "Snapshot service is not available for this account." }, { status: 403, headers: NO_CACHE_HEADERS })
  }
  const billedModel = String(settings?.model || "per_snapshot") !== "plan"
    ? Number(settings?.perSnapshotPrice ?? 20) > 0
    : Boolean(await prisma.snapshotPlan.findFirst({ where: { active: true, archived: false }, select: { id: true } }).catch(() => null))
  if (billedModel) {
    return NextResponse.json({
      success: false,
      error: "Snapshots are billed. Start the pay-and-create flow to continue.",
      code: "snapshot_purchase_required",
      purchaseEndpoint: "/api/client/snapshot-purchases",
    }, { status: 402, headers: NO_CACHE_HEADERS })
  }

  try {
    const operationId = randomUUID()
    runOperationBackground({
      operationId,
      kind: "snapshot",
      vpsInstanceId: instance.id,
      customerId,
      vmId: Number(instance.vmid),
      headline: `Creating snapshot "${name}"`,
      nodeName: (instance.proxmoxNode?.nodeName as string | null) || undefined,
      run: async (report) => {
        report({ phase: "Creating snapshot", status: "running" as const })
        const result = await createVmSnapshot({ nodeId: instance.proxmoxNodeId!, vmid: Number(instance.vmid), name, description, vmstate, actor: "client" })
        report({ phase: "Snapshot created", status: "completed" as const, result: { snapshot: result.snapshot } })
      },
    })
    return NextResponse.json({ success: true, snapshot: { name, vmstate }, operationId }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Snapshot creation failed" }, { status: error?.status || 500, headers: NO_CACHE_HEADERS })
  }
}