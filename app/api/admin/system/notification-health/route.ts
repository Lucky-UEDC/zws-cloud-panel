import { NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { getAdminFromCookies } from "@/lib/server-auth"
import { sessionExpiredJson } from "@/lib/auth/session-expired-response"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { notificationHealthSnapshot } from "@/lib/notifications/ledger"
import { getWhatsAppQueueStats } from "@/lib/whatsapp/queue"

export const dynamic = "force-dynamic"

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return sessionExpiredJson()
  const [ledger, whatsappQueues] = await Promise.all([
    notificationHealthSnapshot(),
    getWhatsAppQueueStats().catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) })),
  ])
  return NextResponse.json({ ok: true, ledger, whatsappQueues, checkedAt: new Date().toISOString() }, { headers: NO_CACHE_HEADERS })
}
