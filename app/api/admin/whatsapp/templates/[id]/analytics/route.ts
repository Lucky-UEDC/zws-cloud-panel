import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getWhatsAppTemplateAnalytics } from "@/lib/whatsapp/templates"
import { badRequest, jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWhatsAppAdmin(request)
    const { id } = await params
    const template = await (prisma as any).whatsAppTemplate.findUnique({ where: { id } })
    if (!template) badRequest("Template not found.")
    const analytics = await getWhatsAppTemplateAnalytics(template.key)
    return NextResponse.json({ ok: true, analytics }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
