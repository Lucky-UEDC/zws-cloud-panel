import { NextRequest, NextResponse } from "next/server"
import { listWhatsAppConversationMessages } from "@/lib/whatsapp/crm"
import { jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWhatsAppAdmin(request)
    const { id } = await params
    const url = new URL(request.url)
    const messages = await listWhatsAppConversationMessages(id, Number(url.searchParams.get("pageSize") || 100))
    return NextResponse.json({ ok: true, messages }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
