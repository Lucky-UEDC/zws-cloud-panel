import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireRecentMfa, requireSameOriginOrCsrf } from "@/lib/auth/guards"
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
  const auth = await requireRecentMfa(request, "client")
  if (!auth.ok) return auth.response
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response

  const customer = await prisma.customer.findUnique({
    where: { id: String(auth.session.userId) },
    select: { id: true, email: true, name: true, phone: true, hashedPassword: true },
  })
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const action = String(body?.action || "")

  try {
    if (action === "start_old") {
      return NextResponse.json(await startOldPhoneVerification({
        type: "customer",
        id: customer.id,
        phone: customer.phone,
        hashedPassword: customer.hashedPassword,
        password: String(body?.password || ""),
        name: customer.name,
        email: customer.email,
      }))
    }
    if (action === "verify_old") {
      return NextResponse.json(await verifyOldPhone({ type: "customer", id: customer.id, otp: String(body?.otp || "") }))
    }
    if (action === "start_new") {
      return NextResponse.json(await startNewPhoneVerification({
        type: "customer",
        id: customer.id,
        phone: String(body?.phone || ""),
        name: customer.name,
        email: customer.email,
      }))
    }
    if (action === "verify_new") {
      return NextResponse.json(await verifyNewPhoneAndCommit({ type: "customer", id: customer.id, otp: String(body?.otp || "") }))
    }
    return NextResponse.json({ error: "Unsupported phone change action" }, { status: 400 })
  } catch (error) {
    return errorResponse(error)
  }
}
