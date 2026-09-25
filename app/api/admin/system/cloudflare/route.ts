import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import {
  createCloudflareTunnel,
  generateCloudflareTunnelArtifacts,
  getCloudflareTunnelReport,
  restartCloudflaredService,
  rotateCloudflareTunnelCredentials,
  validateCloudflareOnlyReadiness,
} from "@/lib/cloudflare-tunnel-manager"
import { createAuditLog } from "@/lib/audit-log"
import { getAdminFromCookies } from "@/lib/server-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return null
  return admin
}

/** Never send raw Cloudflare API/tunnel tokens to the browser. */
function stripTokens(value: any) {
  if (!value || typeof value !== "object") return value
  const copy = { ...value }
  delete copy.token
  delete copy.tunnelToken
  if (copy.configured && typeof copy.configured === "object") {
    copy.configured = { ...copy.configured }
    delete copy.configured.token
    delete copy.configured.tunnelToken
  }
  return copy
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const report = await getCloudflareTunnelReport()
  return NextResponse.json({ success: true, report })
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const action = String(body.action || "").trim()
  try {
    let result: unknown = null
    if (action === "create") result = await createCloudflareTunnel(String(body.name || "myrdphub-production"))
    if (action === "restart") result = await restartCloudflaredService()
    if (action === "rotate") result = await rotateCloudflareTunnelCredentials(String(body.tunnelId || process.env.CF_TUNNEL_ID || ""))
    if (action === "generate-artifacts") {
      result = await generateCloudflareTunnelArtifacts({
        tunnelId: String(body.tunnelId || process.env.CF_TUNNEL_ID || ""),
        tunnelName: String(body.name || "myrdphub-production"),
      })
    }
    if (action === "validate-direct") result = await validateCloudflareOnlyReadiness()
    if (action === "verify") result = await getCloudflareTunnelReport()
    if (!result) return NextResponse.json({ success: false, error: "Unsupported Cloudflare action" }, { status: 400 })
    const tokenReturned = Boolean((result as any)?.token || (result as any)?.tunnelToken)
    await createAuditLog({
      actorEmail: String(admin.email),
      action: `CLOUDFLARE_${action.toUpperCase()}`,
      targetType: "cloudflare_tunnel",
      targetId: String((result as any)?.tunnel?.id || body.tunnelId || process.env.CF_TUNNEL_ID || ""),
      metadata: { action, tokenReturned },
    })
    return NextResponse.json({ success: true, action, result: stripTokens(result) })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Cloudflare action failed" }, { status: 400 })
  }
}
