import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSameOriginOrCsrf } from "@/lib/auth/guards"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"
import {
  startNewPhoneVerification,
  startOldPhoneVerification,
  verifyNewPhoneAndCommit,
  verifyOldPhone,
} from "@/lib/secure-phone-change"

function errorResponse(error: unknown) {
  const status = Number((error as Error & { status?: number })?.status || 400)
  return NextResponse.json({ error: error instanceof Error ? error.message : "Phone change failed" }, { status })
}

export async function POST(request: NextRequest) {
  // requireSensitiveAdminMfa conditionally wraps requireRecentMfa after the admin has configured MFA.
  const auth = await requireSensitiveAdminMfa(request)
  if (!auth.ok) return auth.response
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response

  const admin = await prisma.adminProfile.findUnique({
    where: { id: String(auth.session.userId) },
    select: { id: true, email: true, displayName: true, phone: true, hashedPassword: true },
  })
  if (!admin) return NextResponse.json({ error: "Admin not found" }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const action = String(body?.action || "")

  try {
    if (action === "start_old") {
      return NextResponse.json(await startOldPhoneVerification({
        type: "admin",
        id: admin.id,
        phone: admin.phone,
        hashedPassword: admin.hashedPassword,
        password: String(body?.password || ""),
        name: admin.displayName,
        email: admin.email,
      }))
    }
    if (action === "verify_old") {
      return NextResponse.json(await verifyOldPhone({ type: "admin", id: admin.id, otp: String(body?.otp || "") }))
    }
    if (action === "start_new") {
      return NextResponse.json(await startNewPhoneVerification({
        type: "admin",
        id: admin.id,
        phone: String(body?.phone || ""),
        name: admin.displayName,
        email: admin.email,
      }))
    }
    if (action === "verify_new") {
      return NextResponse.json(await verifyNewPhoneAndCommit({ type: "admin", id: admin.id, otp: String(body?.otp || "") }))
    }
    return NextResponse.json({ error: "Unsupported phone change action" }, { status: 400 })
  } catch (error) {
    return errorResponse(error)
  }
}
