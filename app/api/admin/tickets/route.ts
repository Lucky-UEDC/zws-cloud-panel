import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { serializeTicket } from "@/lib/ticket-attachments"
import { validateSecurityField } from "@/lib/security/input"
import { securityGate } from "@/lib/security/forms"
import { rejectDetectedPayload } from "@/lib/security/abuse"

export async function GET(request: NextRequest) {
  const gate = await securityGate(request)
  if (!gate.ok) return gate.response
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const status = request.nextUrl.searchParams.get("status") || undefined
  const qRaw = String(request.nextUrl.searchParams.get("q") || "").trim()
  const qResult = qRaw ? validateSecurityField(qRaw, "search", "Search") : { ok: true as const, value: "" }
  if (!qResult.ok) {
    if ("detection" in qResult && qResult.detection?.dangerous) return rejectDetectedPayload(gate.ctx, qResult.detection, "q")
    return NextResponse.json({ error: "Invalid search query" }, { status: 400 })
  }
  const q = qResult.value

  const tickets = await prisma.supportTicket.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(q ? {
        OR: [
          { ticketNumber: { contains: q, mode: "insensitive" as const } },
          { subject: { contains: q, mode: "insensitive" as const } },
          { customer: { email: { contains: q, mode: "insensitive" as const } } },
        ],
      } : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      customer: { select: { id: true, email: true, name: true } },
      messages: { orderBy: { createdAt: "asc" }, take: 1, include: { attachments: true } },
    },
  })

  return NextResponse.json({ tickets: tickets.map(serializeTicket) })
}
