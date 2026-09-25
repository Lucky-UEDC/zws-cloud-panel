import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { enqueueWhatsAppCampaign } from "@/lib/whatsapp/queue"
import { jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWhatsAppAdmin(request)
    const { id } = await params
    const campaign = await prisma.whatsAppCampaign.update({
      where: { id },
      data: { status: "queued", pausedAt: null },
    })
    await enqueueWhatsAppCampaign({ campaignId: id }).catch(() => null)
    return NextResponse.json({ ok: true, campaign }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
