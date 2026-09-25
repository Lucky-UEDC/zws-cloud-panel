import { NextRequest, NextResponse } from "next/server"
import { clearStuckWhatsAppJobs, getWhatsAppQueueDiagnostics, rebuildWhatsAppQueues, retryFailedWhatsAppJobs } from "@/lib/whatsapp/queue"
import { jsonError, noStoreHeaders, rateLimitWhatsAppDiagnostics, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    rateLimitWhatsAppDiagnostics(request)
    const diagnostics = await getWhatsAppQueueDiagnostics()
    return NextResponse.json({ ok: true, ...diagnostics }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const body = await request.json().catch(() => ({}))
    const action = String(body.action || "")
    let result: unknown
    if (action === "clear-stuck-jobs") result = await clearStuckWhatsAppJobs()
    else if (action === "retry-failed-jobs") result = await retryFailedWhatsAppJobs(Array.isArray(body.jobIds) ? body.jobIds.map(String) : [])
    else if (action === "rebuild-queues") result = await rebuildWhatsAppQueues()
    else {
      return NextResponse.json({ ok: false, error: "Unsupported queue recovery action" }, { status: 400, headers: noStoreHeaders })
    }
    return NextResponse.json({ ok: true, action, result }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
