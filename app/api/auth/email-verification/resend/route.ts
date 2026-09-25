import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromRequest } from "@/lib/server-auth"
import { sendVerificationEmail } from "@/lib/email-verification"

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const email = String(body.email || "").trim().toLowerCase()
  const redirectTo = String(body.redirectTo || "").trim() || null
  const client = await getClientFromRequest(request).catch(() => null)

  const customer = client?.sub
    ? await prisma.customer.findUnique({ where: { id: String(client.sub) } })
    : email
      ? await prisma.customer.findUnique({ where: { email } })
      : null

  if (!customer?.email) {
    return NextResponse.json({ success: true })
  }

  await sendVerificationEmail({
    userId: customer.id,
    redirectTo,
    reason: "resend",
  }).catch(() => null)

  return NextResponse.json({ success: true })
}
