import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { listDuplicateVmIncidents, scanDuplicateManagedVms } from "@/lib/vm-duplicate-quarantine"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { safeApiErrorMessage } from "@/lib/api-error-safe"

export const dynamic = "force-dynamic"

async function admin() {
  const value = await getAdminFromCookies()
  return value?.email && canAccessAdminApi(value.role) ? value : null
}

export async function GET() {
  const current = await admin()
  if (!current) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  const incidents = await listDuplicateVmIncidents()
  return NextResponse.json({ success: true, incidents }, { headers: NO_CACHE_HEADERS })
}

export async function POST(request: Request) {
  const current = await admin()
  if (!current) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  try {
    const body = await request.json().catch(() => ({}))
    const result = await scanDuplicateManagedVms({
      actorEmail: String(current.email),
      nodeId: body.nodeId ? String(body.nodeId) : null,
      createdFrom: body.createdFrom ? new Date(String(body.createdFrom)) : null,
      apply: body.apply !== false,
    })
    return NextResponse.json({ success: true, result }, { headers: NO_CACHE_HEADERS })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Duplicate VM scan failed") }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
