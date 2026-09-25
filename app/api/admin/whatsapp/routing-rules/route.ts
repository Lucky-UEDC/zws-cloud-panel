import crypto from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { badRequest, jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const rules = await (prisma as any).whatsAppGroupRoutingRule.findMany({
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      take: 200,
    }).catch(() => [])
    return NextResponse.json({ ok: true, rules }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const body = await request.json().catch(() => ({}))
    const name = text(body.name)
    if (!name) badRequest("Routing rule name is required.")
    const rule = await (prisma as any).whatsAppGroupRoutingRule.create({
      data: {
        id: `wa_route_${crypto.randomUUID()}`,
        name,
        priority: Number.isFinite(Number(body.priority)) ? Number(body.priority) : 100,
        enabled: body.enabled !== false,
        communityId: text(body.communityId) || null,
        groupId: text(body.groupId) || null,
        conditions: body.conditions && typeof body.conditions === "object" ? body.conditions : {},
        metadata: { metaSafe: true, inviteOnly: true },
      },
    })
    return NextResponse.json({ ok: true, rule }, { status: 201, headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
