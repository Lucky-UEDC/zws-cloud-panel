import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { adminQueueReinstall } from "@/lib/admin-vm-management"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const loginMethodRaw = String(body.loginMethod || "password").toLowerCase()
    const loginMethod = ["password", "ssh", "password_ssh"].includes(loginMethodRaw) ? loginMethodRaw : "password"

    const result = await adminQueueReinstall({
      vpsId: id,
      templateId: String(body.templateId || body.osTemplateId || ""),
      hostname: String(body.hostname || "").trim() || "",
      loginMethod: loginMethod as "password" | "ssh" | "password_ssh",
      password: body.password ? String(body.password) : null,
      sshPublicKey: body.sshPublicKey ? String(body.sshPublicKey) : null,
      sshKeyId: body.sshKeyId ? String(body.sshKeyId) : null,
      preserveIp: body.preserveIp !== false,
      reason: body.reason ? String(body.reason) : null,
      actorEmail: String(admin.email),
    })

    const status = result.queued ? 200 : 409
    return NextResponse.json({ success: result.queued, result }, { status })
  } catch (error: any) {
    const supportCode = buildSupportCode("VM-REINSTALL")
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Reinstall failed"), supportCode }, { status: 400 })
  }
}
