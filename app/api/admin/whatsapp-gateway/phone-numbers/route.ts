import { NextResponse } from "next/server"
import { jsonError, noStoreHeaders, requireGatewayAdmin } from "../_shared"
import { listGatewayPhoneNumbers } from "@/lib/whatsapp-gateway/connections"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    await requireGatewayAdmin(request)
    const phoneNumbers = await listGatewayPhoneNumbers()
    return NextResponse.json({ ok: true, phoneNumbers }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}