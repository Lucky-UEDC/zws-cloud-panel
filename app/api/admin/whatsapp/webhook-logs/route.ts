import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const url = new URL(request.url)
    const status = url.searchParams.get("status")
    const event = url.searchParams.get("event")
    const logs = await (prisma as any).whatsAppWebhookEvent.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(event ? { event: { contains: event, mode: "insensitive" } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") || 100))),
    }).catch(() => [])
    return NextResponse.json({ ok: true, logs }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
