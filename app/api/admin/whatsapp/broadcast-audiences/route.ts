import crypto from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { badRequest, jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_ -]/g, "").replace(/[\s-]+/g, "_").replace(/^_+|_+$/g, "")
}

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const audiences = await (prisma as any).whatsAppBroadcastAudience.findMany({ orderBy: { createdAt: "desc" }, take: 100 }).catch(() => [])
    return NextResponse.json({ ok: true, audiences }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const body = await request.json().catch(() => ({}))
    const name = text(body.name)
    if (!name) badRequest("Audience name is required.")
    const admin = await getAdminFromCookies()
    const audience = await (prisma as any).whatsAppBroadcastAudience.create({
      data: {
        id: `wa_aud_${crypto.randomUUID()}`,
        name,
        slug: slugify(text(body.slug) || name),
        description: text(body.description) || null,
        filter: body.filter && typeof body.filter === "object" ? body.filter : {},
        createdBy: admin?.email || "server-token",
      },
    })
    return NextResponse.json({ ok: true, audience }, { status: 201, headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
