import { NextRequest, NextResponse } from "next/server"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { redactForLog } from "@/lib/log-redaction"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const message = typeof body?.message === "string" ? body.message.slice(0, 500) : ""

  console.error("[frontend_error]", redactForLog({
    source: typeof body?.source === "string" ? body.source.slice(0, 80) : "unknown",
    name: typeof body?.name === "string" ? body.name.slice(0, 120) : null,
    message,
    digest: typeof body?.digest === "string" ? body.digest.slice(0, 120) : null,
    path: typeof body?.path === "string" ? body.path.slice(0, 300) : null,
    userAgent: typeof body?.userAgent === "string" ? body.userAgent.slice(0, 300) : null,
  }))

  return NextResponse.json({ ok: true }, { headers: NO_CACHE_HEADERS })
}
