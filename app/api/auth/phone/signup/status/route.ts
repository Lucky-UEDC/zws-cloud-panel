import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { normalizeSignupPhone } from "@/lib/auth/phone-verification"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const verificationId = String(body?.verificationId || "")
  if (!verificationId) {
    return NextResponse.json({ success: false, code: "verification_missing", message: "Verification session was not found." }, { status: 400 })
  }

  const record = await (prisma as any).phoneVerification.findUnique({
    where: { id: verificationId },
    select: { id: true, phone: true, countryCode: true, deliveryStatus: true, whatsappMessageId: true, verifiedAt: true, consumedAt: true, expiresAt: true },
  }).catch(() => null)
  if (!record) {
    return NextResponse.json({ success: false, code: "verification_missing", message: "Verification session was not found." }, { status: 404 })
  }

  const phone = String(body?.phone || "")
  if (phone) {
    const normalized = normalizeSignupPhone(phone, String(body?.countryCode || record.countryCode || ""))
    if (normalized.phone !== record.phone) {
      return NextResponse.json({ success: false, code: "verification_phone_mismatch", message: "Verification session was not found for this phone number." }, { status: 404 })
    }
  }

  const expired = record.expiresAt?.getTime?.() < Date.now()
  const deliveryStatus = expired && !record.verifiedAt ? "expired" : String(record.deliveryStatus || "queued")
  return NextResponse.json({
    success: true,
    verificationId: record.id,
    deliveryStatus,
    whatsappMessageId: record.whatsappMessageId || null,
    verified: Boolean(record.verifiedAt && !record.consumedAt),
    providerUnavailable: deliveryStatus === "provider_unavailable",
    message: deliveryStatus === "provider_unavailable" ? "WhatsApp is not available on this number." : null,
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  })
}
