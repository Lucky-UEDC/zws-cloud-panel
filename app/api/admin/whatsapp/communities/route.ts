import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { createWhatsAppCommunity } from "@/lib/whatsapp/community"
import { badRequest, jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const [communities, groups, invites] = await Promise.all([
      (prisma as any).whatsAppCommunity.findMany({ orderBy: { createdAt: "desc" }, take: 100 }).catch(() => []),
      (prisma as any).whatsAppGroup.findMany({ orderBy: { createdAt: "desc" }, take: 200 }).catch(() => []),
      (prisma as any).whatsAppGroupInvite.findMany({ orderBy: { createdAt: "desc" }, take: 100 }).catch(() => []),
    ])
    return NextResponse.json({ ok: true, communities, groups, invites }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const body = await request.json().catch(() => ({}))
    const name = text(body.name)
    if (!name) badRequest("Community name is required.")
    const admin = await getAdminFromCookies()
    const community = await createWhatsAppCommunity({
      name,
      slug: text(body.slug) || null,
      description: text(body.description) || null,
      category: text(body.category) || "customer",
      language: text(body.language) || null,
      country: text(body.country) || null,
      region: text(body.region) || null,
      createdBy: admin?.email || "server-token",
    })
    return NextResponse.json({ ok: true, community }, { status: 201, headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
