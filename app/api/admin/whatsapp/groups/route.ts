import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { createWhatsAppGroup } from "@/lib/whatsapp/community"
import { badRequest, jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const url = new URL(request.url)
    const communityId = text(url.searchParams.get("communityId"))
    const [groups, invites, members] = await Promise.all([
      (prisma as any).whatsAppGroup.findMany({
        where: communityId ? { communityId } : {},
        orderBy: { createdAt: "desc" },
        take: 200,
      }).catch(() => []),
      (prisma as any).whatsAppGroupInvite.findMany({ orderBy: { createdAt: "desc" }, take: 100 }).catch(() => []),
      (prisma as any).whatsAppGroupMember.groupBy({
        by: ["groupId", "status"],
        _count: { _all: true },
      }).catch(() => []),
    ])
    return NextResponse.json({ ok: true, groups, invites, memberStats: members }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const body = await request.json().catch(() => ({}))
    const name = text(body.name)
    if (!name) badRequest("Group name is required.")
    const admin = await getAdminFromCookies()
    const group = await createWhatsAppGroup({
      name,
      slug: text(body.slug) || null,
      communityId: text(body.communityId) || null,
      description: text(body.description) || null,
      category: text(body.category) || "customer",
      language: text(body.language) || null,
      country: text(body.country) || null,
      region: text(body.region) || null,
      service: text(body.service) || null,
      plan: text(body.plan) || null,
      product: text(body.product) || null,
      inviteLink: text(body.inviteLink) || null,
      approvalMode: text(body.approvalMode) || "optional",
      createdBy: admin?.email || "server-token",
    })
    return NextResponse.json({ ok: true, group }, { status: 201, headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
