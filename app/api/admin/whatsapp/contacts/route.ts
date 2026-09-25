import { NextRequest, NextResponse } from "next/server"
import { listWhatsAppContacts, syncWhatsAppCustomerContacts } from "@/lib/whatsapp/crm"
import { jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const url = new URL(request.url)
    const contacts = await listWhatsAppContacts({
      search: url.searchParams.get("q"),
      pageSize: Number(url.searchParams.get("pageSize") || 100),
    })
    return NextResponse.json({ ok: true, contacts }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const result = await syncWhatsAppCustomerContacts(2000)
    return NextResponse.json({ ok: true, ...result }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
