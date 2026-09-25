import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { createWhatsAppCampaign } from "@/lib/whatsapp/campaigns"
import { badRequest, jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const campaigns = await prisma.whatsAppCampaign.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { logs: { orderBy: { createdAt: "desc" }, take: 5 } },
    })
    const campaignIds = campaigns.map((campaign) => campaign.id)
    const [messages, recipients, events] = await Promise.all([
      (prisma as any).whatsAppCampaignMessage.findMany({ where: { campaignId: { in: campaignIds } }, orderBy: [{ campaignId: "asc" }, { stepOrder: "asc" }] }).catch(() => []),
      (prisma as any).whatsAppCampaignRecipient.groupBy({
        by: ["campaignId", "status"],
        where: { campaignId: { in: campaignIds } },
        _count: { _all: true },
      }).catch(() => []),
      (prisma as any).whatsAppCampaignEvent.findMany({
        where: { campaignId: { in: campaignIds } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }).catch(() => []),
    ])
    return NextResponse.json({ ok: true, campaigns, messages, recipientStats: recipients, events }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const body = await request.json().catch(() => ({}))
    const name = text(body.name)
    const message = text(body.message)
    if (!name) badRequest("Campaign name is required.")
    if (!message && !body.mediaUrl && !body.mediaAssetId && !body.templateId) badRequest("Campaign message, template, or media is required.")
    const scheduledAt = text(body.scheduledAt) ? new Date(text(body.scheduledAt)) : null
    const admin = await getAdminFromCookies()

    const campaign = await createWhatsAppCampaign({
      name,
      type: text(body.type) || null,
      provider: text(body.provider) || null,
      message,
      caption: text(body.caption) || null,
      mediaUrl: text(body.mediaUrl) || null,
      mediaAssetId: text(body.mediaAssetId) || null,
      mediaType: text(body.mediaType) || null,
      templateId: text(body.templateId) || null,
      templateVersionId: text(body.templateVersionId) || null,
      templateLanguage: text(body.templateLanguage) || null,
      buttons: Array.isArray(body.buttons) ? body.buttons : [],
      recurrence: body.recurrence && typeof body.recurrence === "object" ? body.recurrence : {},
      timezone: text(body.timezone) || "UTC",
      pacingPolicy: body.pacingPolicy && typeof body.pacingPolicy === "object" ? body.pacingPolicy : {},
      compliance: body.compliance && typeof body.compliance === "object" ? body.compliance : {},
      audienceFilter: body.audienceFilter && typeof body.audienceFilter === "object" ? body.audienceFilter : {},
      scheduledAt: scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt : null,
      createdBy: admin?.email || "server-token",
    })

    return NextResponse.json({ ok: true, campaign }, { status: 201, headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
