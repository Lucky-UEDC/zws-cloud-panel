import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromCookies } from "@/lib/server-auth"
import { getCustomerNotificationPreferences, NOTIFICATION_CATEGORIES, upsertCustomerNotificationPreferences } from "@/lib/whatsapp/preferences"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function requireClient() {
  const client = await getClientFromCookies()
  if (!client?.sub) return null
  return String(client.sub)
}

export async function GET() {
  const customerId = await requireClient()
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const [customer, preferences] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: customerId },
      select: { whatsappOptIn: true, phoneVerified: true, phoneVerifiedAt: true, phone: true },
    }),
    getCustomerNotificationPreferences(customerId),
  ])

  return NextResponse.json({
    success: true,
    whatsappOptIn: customer?.whatsappOptIn ?? true,
    phoneVerified: customer?.phoneVerified ?? false,
    phoneVerifiedAt: customer?.phoneVerifiedAt ?? null,
    phone: customer?.phone ?? null,
    categories: NOTIFICATION_CATEGORIES,
    preferences,
  })
}

export async function PUT(request: NextRequest) {
  const customerId = await requireClient()
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const whatsappOptIn = typeof body?.whatsappOptIn === "boolean" ? body.whatsappOptIn : undefined
  const preferences = Array.isArray(body?.preferences) ? body.preferences : []

  await prisma.customer.update({
    where: { id: customerId },
    data: { whatsappOptIn },
  })
  await upsertCustomerNotificationPreferences(customerId, preferences)

  return GET()
}
