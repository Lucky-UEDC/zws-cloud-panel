import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { listWhatsAppAutoReplyRules } from "@/lib/whatsapp/crm"
import { badRequest, jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../_shared"
import { getAdminFromCookies } from "@/lib/server-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function text(value: unknown) {
  return String(value || "").trim()
}

function keywords(value: unknown) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean)
  return text(value).split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)
}

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const rules = await listWhatsAppAutoReplyRules()
    return NextResponse.json({ ok: true, rules }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const admin = await getAdminFromCookies()
    const body = await request.json().catch(() => ({}))
    const name = text(body.name)
    const replyText = text(body.replyText)
    const ruleKeywords = keywords(body.keywords)
    if (!name) badRequest("Rule name is required.")
    if (!ruleKeywords.length) badRequest("At least one keyword is required.")
    if (!replyText) badRequest("Reply text is required.")
    const rule = await (prisma as any).whatsAppAutoReplyRule.create({
      data: {
        name,
        keywords: ruleKeywords as any,
        matchMode: ["contains", "exact", "starts_with"].includes(text(body.matchMode)) ? text(body.matchMode) : "contains",
        replyText,
        enabled: body.enabled !== false,
        priority: Number.isFinite(Number(body.priority)) ? Number(body.priority) : 100,
        createdBy: admin?.email || null,
      },
    })
    return NextResponse.json({ ok: true, rule }, { status: 201, headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
