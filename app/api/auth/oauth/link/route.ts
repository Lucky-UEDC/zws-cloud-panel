import { NextRequest, NextResponse } from "next/server"
import { getAdminFromRequest, getClientFromRequest } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

function roleFromSession(admin: any, client: any) {
  if (admin?.sub) return "admin"
  if (client?.sub) return "client"
  return null
}

export async function POST(request: NextRequest) {
  const [admin, client] = await Promise.all([
    getAdminFromRequest(request).catch(() => null),
    getClientFromRequest(request).catch(() => null),
  ])
  const role = roleFromSession(admin, client)
  if (!role) return NextResponse.json({ error: "Sign in before linking OAuth.", code: "login_required" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const next = String(body?.next || (role === "admin" ? "/admin/account-security" : "/client-area/security/mfa"))
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : role === "admin" ? "/admin/account-security" : "/client-area/security/mfa"
  return NextResponse.json({
    success: true,
    url: `/api/auth/google/start?mode=link&role=${encodeURIComponent(role)}&next=${encodeURIComponent(safeNext)}`,
  })
}
