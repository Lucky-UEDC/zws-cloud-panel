import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { createRenewalInvoice, renewVpsFromPaidInvoice, suspendOverdueVps } from "@/lib/renewals"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { runAdminVmAction } from "@/lib/admin-vm-management"

const DEPRECATED_HEADERS = {
  "X-ZWS-Deprecated": "true",
  "X-ZWS-Replacement": "/api/admin/vms/:id",
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: DEPRECATED_HEADERS })
  }
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const action = String(body.action || "")
  const vps = await prisma.vpsInstance.findUnique({
    where: { id },
    include: { customer: true, product: true, order: true, proxmoxNode: true },
  })
  if (!vps) return NextResponse.json({ success: false, error: "VPS not found" }, { status: 404, headers: DEPRECATED_HEADERS })

  if (action === "renew") {
    const invoice = await createRenewalInvoice(vps)
    const paid = await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "paid", paidAt: new Date() } })
    const updated = await renewVpsFromPaidInvoice(paid)
    return NextResponse.json({ success: true, invoice: paid, vps: updated, deprecated: { route: "/api/admin/vps/[id]/renewal", replacement: "/api/admin/vms/[id]" } }, { headers: DEPRECATED_HEADERS })
  }
  if (action === "suspend") {
    const updated = await suspendOverdueVps(vps)
    return NextResponse.json({ success: true, vps: updated, deprecated: { route: "/api/admin/vps/[id]/renewal", replacement: "/api/admin/vms/[id]" } }, { headers: DEPRECATED_HEADERS })
  }
  if (action === "unsuspend") {
    const updated = await runAdminVmAction({ vpsId: vps.id, action: "unsuspend", actorEmail: String(admin.email) })
    return NextResponse.json({ success: true, vps: updated, deprecated: { route: "/api/admin/vps/[id]/renewal", replacement: "/api/admin/vms/[id]" } }, { headers: DEPRECATED_HEADERS })
  }

  return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400, headers: DEPRECATED_HEADERS })
}
