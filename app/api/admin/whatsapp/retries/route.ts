import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { jsonError, noStoreHeaders, rateLimitWhatsAppDiagnostics, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    rateLimitWhatsAppDiagnostics(request)
    const retries = await (prisma as any).whatsAppQueueLog.findMany({
      where: { OR: [{ status: "retrying" }, { event: { contains: "retry", mode: "insensitive" } }] },
      orderBy: { createdAt: "desc" },
      take: 100,
    }).catch(() => [])
    return NextResponse.json({ ok: true, retries }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
