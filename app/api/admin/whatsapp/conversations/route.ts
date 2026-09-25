import { NextRequest, NextResponse } from "next/server"
import { listWhatsAppConversations } from "@/lib/whatsapp/crm"
import { jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const url = new URL(request.url)
    const conversations = await listWhatsAppConversations({
      search: url.searchParams.get("q"),
      pageSize: Number(url.searchParams.get("pageSize") || 100),
    })
    return NextResponse.json({ ok: true, conversations }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
