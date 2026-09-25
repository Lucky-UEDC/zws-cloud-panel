import { NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { clientActivityCategory, clientActivityMessage, clientActivityTitle, normalizeLogSeverity } from "@/lib/log-format"

export const dynamic = "force-dynamic"
export const revalidate = 0

function serialize(row: any) {
  const message = clientActivityMessage(row.reason || row.eventType)
  return {
    id: row.id,
    timestamp: row.timestamp,
    severity: normalizeLogSeverity(row.severity),
    category: clientActivityCategory(row.eventType),
    title: clientActivityTitle(message),
    message,
    status: row.status,
    orderId: row.orderId,
    vpsInstanceId: row.vpsInstanceId || row.vmId,
  }
}

export async function GET() {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const rows = await (prisma as any).auditEvent.findMany({
    where: { customerId },
    orderBy: { timestamp: "desc" },
    take: 200,
  }).catch(() => [])
  return NextResponse.json({ success: true, events: rows.map(serialize) })
}
