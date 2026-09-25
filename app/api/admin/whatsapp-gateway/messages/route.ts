import { NextResponse } from "next/server"
import { jsonError, noStoreHeaders, requireGatewayAdmin } from "../_shared"
import { listGatewayMessages } from "@/lib/whatsapp-gateway/messages"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    await requireGatewayAdmin(request)
    const url = new URL(request.url)
    const result = await listGatewayMessages({
      page: Number(url.searchParams.get("page") || 1),
      pageSize: Number(url.searchParams.get("pageSize") || 20),
      status: url.searchParams.get("status") || undefined,
      messageType: url.searchParams.get("messageType") || undefined,
      phone: url.searchParams.get("phone") || undefined,
      sender: url.searchParams.get("sender") || undefined,
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
    })
    return NextResponse.json({ ok: true, ...result }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}