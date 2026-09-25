import { NextRequest, NextResponse } from "next/server"
import { requireAdminFullAuth, requireSameOriginOrCsrf } from "@/lib/auth/guards"
import { getRuntimeSecurityPolicy, updateRuntimeSecurityPolicy, type MfaPolicyMode } from "@/lib/security-policy"
import { writeAuditLog } from "@/lib/audit-log"
import { extractClientIp } from "@/lib/request-context"

const modes = new Set<MfaPolicyMode>(["disabled", "recommend", "enforce"])

export async function GET(request: NextRequest) {
  const auth = await requireAdminFullAuth(request)
  if (!auth.ok) return auth.response
  return NextResponse.json({ success: true, policy: await getRuntimeSecurityPolicy() })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminFullAuth(request)
  if (!auth.ok) return auth.response
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response

  const body = await request.json().catch(() => ({}))
  const mfaMode = String(body?.mfaMode || "") as MfaPolicyMode
  if (!modes.has(mfaMode)) {
    return NextResponse.json({ success: false, error: "Unsupported MFA policy mode." }, { status: 400 })
  }

  const policy = await updateRuntimeSecurityPolicy({ mfaMode }, auth.session.email)
  await writeAuditLog({
    action: "SECURITY_POLICY_UPDATED",
    actorEmail: auth.session.email,
    adminId: auth.session.userId,
    targetType: "security_policy",
    metadata: { mfaMode },
    ipAddress: extractClientIp(request),
    userAgent: request.headers.get("user-agent") || null,
  }).catch(() => null)

  return NextResponse.json({ success: true, policy })
}
