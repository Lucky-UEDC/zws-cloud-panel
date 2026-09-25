import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET(_: Request, { params }: { params: Promise<{ merchantOrderId: string }> }) {
  const { merchantOrderId } = await params
  const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantOrderId } })
  if (!attempt) return NextResponse.json({ ok: false, code: "NOT_FOUND", error: "Payment attempt not found." }, { status: 404 })
  return NextResponse.json({
    ok: true,
    merchantOrderId,
    paymentAttemptId: attempt.id,
    gateway: attempt.gateway,
    status: attempt.status,
    verified: Boolean(attempt.webhookVerifiedAt || attempt.status === "success"),
  })
}
