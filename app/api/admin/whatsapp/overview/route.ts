import { NextRequest, NextResponse } from "next/server"
import { getWhatsAppCrmOverview } from "@/lib/whatsapp/crm"
import { jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const overview = await getWhatsAppCrmOverview()
    return NextResponse.json({ ok: true, ...overview }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
