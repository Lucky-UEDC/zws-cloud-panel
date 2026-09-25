import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { badRequest, jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function text(value: unknown) {
  return String(value || "").trim()
}

function keywords(value: unknown) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean)
  return text(value).split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWhatsAppAdmin(request)
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const data: Record<string, unknown> = {}
    if (body.name !== undefined) data.name = text(body.name)
    if (body.keywords !== undefined) data.keywords = keywords(body.keywords) as any
    if (body.matchMode !== undefined) data.matchMode = ["contains", "exact", "starts_with"].includes(text(body.matchMode)) ? text(body.matchMode) : "contains"
    if (body.replyText !== undefined) data.replyText = text(body.replyText)
    if (body.enabled !== undefined) data.enabled = Boolean(body.enabled)
    if (body.priority !== undefined) data.priority = Number.isFinite(Number(body.priority)) ? Number(body.priority) : 100
    if (!Object.keys(data).length) badRequest("No changes provided.")
    const rule = await (prisma as any).whatsAppAutoReplyRule.update({ where: { id }, data })
    return NextResponse.json({ ok: true, rule }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWhatsAppAdmin(request)
    const { id } = await params
    await (prisma as any).whatsAppAutoReplyRule.delete({ where: { id } })
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
