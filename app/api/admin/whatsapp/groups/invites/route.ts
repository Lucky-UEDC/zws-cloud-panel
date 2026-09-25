import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { createWhatsAppGroupInvite } from "@/lib/whatsapp/community"
import { badRequest, jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const invites = await (prisma as any).whatsAppGroupInvite.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    }).catch(() => [])
    return NextResponse.json({ ok: true, invites }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const body = await request.json().catch(() => ({}))
    const groupId = text(body.groupId)
    const inviteLink = text(body.inviteLink)
    if (!groupId) badRequest("Group is required.")
    if (!inviteLink) badRequest("Invite link is required. Forced joins are not supported.")
    const group = await (prisma as any).whatsAppGroup.findUnique({ where: { id: groupId } }).catch(() => null)
    if (!group) badRequest("Group not found.")
    const admin = await getAdminFromCookies()
    const expiresAt = text(body.expiresAt) ? new Date(text(body.expiresAt)) : null
    const invite = await createWhatsAppGroupInvite({
      groupId,
      communityId: group.communityId || null,
      campaignId: text(body.campaignId) || null,
      customerId: text(body.customerId) || null,
      inviteLink,
      approvalMode: text(body.approvalMode) || group.approvalMode || "optional",
      usageLimit: Number.isFinite(Number(body.usageLimit)) ? Number(body.usageLimit) : null,
      expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
      generatedBy: admin?.email || "server-token",
      metadata: { metaSafe: true, forcedJoin: false },
    })
    return NextResponse.json({ ok: true, invite }, { status: 201, headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const body = await request.json().catch(() => ({}))
    const id = text(body.id)
    const action = text(body.action)
    if (!id) badRequest("Invite id is required.")
    const data: any = {}
    if (action === "disable") {
      data.status = "disabled"
      data.disabledAt = new Date()
    } else if (action === "regenerate") {
      const inviteLink = text(body.inviteLink)
      if (!inviteLink) badRequest("New invite link is required.")
      data.inviteLink = inviteLink
      data.status = "active"
      data.disabledAt = null
      data.usageCount = 0
    } else {
      badRequest("Unsupported invite action.")
    }
    const invite = await (prisma as any).whatsAppGroupInvite.update({ where: { id }, data })
    return NextResponse.json({ ok: true, invite }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
