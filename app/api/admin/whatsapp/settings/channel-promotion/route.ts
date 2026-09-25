import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { createWhatsAppCampaign } from "@/lib/whatsapp/campaigns"
import { enqueueWhatsAppCampaign } from "@/lib/whatsapp/queue"
import { jsonError, noStoreHeaders } from "../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SETTING_KEY = "whatsapp.channel_promotion_template"
const DEFAULT_TEMPLATE = `🚀 Stay Updated with MY RDP HUB

Join our official WhatsApp Channel to receive:

• Instant offers & deals
• Maintenance updates
• New VPS locations
• Product launches
• Service announcements
• Exclusive discounts

Join here:
https://whatsapp.com/channel/0029Vb78RYI9RZAeokizPu0i`

async function getTemplate(): Promise<string> {
  const row = await prisma.adminSetting.findUnique({ where: { key: SETTING_KEY } }).catch(() => null)
  if (row && typeof (row.value as any)?.body === "string") return (row.value as any).body
  return DEFAULT_TEMPLATE
}

async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin) {
    const err = new Error("Unauthorized")
    ;(err as any).status = 401
    throw err
  }
  return admin
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin()
    const body = await getTemplate()
    return NextResponse.json({ ok: true, body }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const admin = await requireAdmin()
    const payload = await request.json().catch(() => ({}))
    const body = typeof payload?.body === "string" ? payload.body.trim() : null
    if (!body) return NextResponse.json({ ok: false, error: "body is required" }, { status: 400, headers: noStoreHeaders })

    await prisma.adminSetting.upsert({
      where: { key: SETTING_KEY },
      update: { value: { body, updatedBy: admin.email || "admin", updatedAt: new Date().toISOString() } as any },
      create: {
        key: SETTING_KEY,
        value: { body, updatedBy: admin.email || "admin", updatedAt: new Date().toISOString() } as any,
        description: "WhatsApp channel promotion message template",
      },
    })

    return NextResponse.json({ ok: true, body }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin()
    const templateBody = await getTemplate()

    const campaign = await createWhatsAppCampaign({
      name: `Channel Promotion — ${new Date().toLocaleDateString("en-IN")}`,
      type: "text",
      message: templateBody,
      audienceFilter: { hasPhone: true, phoneVerified: true, whatsappOptIn: true },
      createdBy: admin.email || "admin",
    })

    await enqueueWhatsAppCampaign({ campaignId: campaign.id })

    return NextResponse.json({ ok: true, campaignId: campaign.id }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
