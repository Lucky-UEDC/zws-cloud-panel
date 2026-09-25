import { NextRequest, NextResponse } from "next/server"
import { enqueueWhatsAppCampaign } from "@/lib/whatsapp/queue"
import { jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWhatsAppAdmin(request)
    const { id } = await params
    const job = await enqueueWhatsAppCampaign({ campaignId: id, retryFailedOnly: true })
    return NextResponse.json({ ok: true, jobId: job.id || null }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
