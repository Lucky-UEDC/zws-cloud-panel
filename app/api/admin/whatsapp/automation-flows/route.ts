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
    const [flows, runs] = await Promise.all([
      (prisma as any).whatsAppAutomationFlow.findMany({ orderBy: { createdAt: "desc" }, take: 100 }).catch(() => []),
      (prisma as any).whatsAppAutomationFlowRun.findMany({ orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []),
    ])
    return NextResponse.json({ ok: true, flows, runs }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const body = await request.json().catch(() => ({}))
    const name = text(body.name)
    const trigger = text(body.trigger)
    if (!name) badRequest("Flow name is required.")
    if (!trigger) badRequest("Flow trigger is required.")
    const admin = await getAdminFromCookies()
    const flow = await (prisma as any).whatsAppAutomationFlow.create({
      data: {
        id: `wa_flow_${crypto.randomUUID()}`,
        name,
        slug: slugify(text(body.slug) || name),
        trigger,
        status: text(body.status) || "draft",
        steps: Array.isArray(body.steps) ? body.steps : [],
        metadata: { inviteOnly: true, otpVerified: trigger.includes("verified") },
        createdBy: admin?.email || "server-token",
      },
    })
    return NextResponse.json({ ok: true, flow }, { status: 201, headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
