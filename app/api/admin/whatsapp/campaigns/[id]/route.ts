import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWhatsAppAdmin(request)
    const { id } = await params
    const campaign = await prisma.whatsAppCampaign.findUnique({
      where: { id },
      include: { logs: { orderBy: { createdAt: "desc" }, take: 100 } },
    })
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404, headers: noStoreHeaders })
    return NextResponse.json({ ok: true, campaign }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
