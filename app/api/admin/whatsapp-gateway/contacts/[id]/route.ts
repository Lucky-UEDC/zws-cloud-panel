import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { badRequest, jsonError, noStoreHeaders, requireGatewayAdmin } from "../../_shared"
import { gatewayContactInputSchema } from "@/lib/whatsapp-gateway/validate"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireGatewayAdmin(request)
    const { id } = await context.params
    const body = await request.json().catch(() => badRequest("Invalid JSON body"))
    const parsed = gatewayContactInputSchema.partial().safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return badRequest(issue ? issue.message : "Invalid contact update")
    }

    const existing = await prisma.whatsAppGatewayContact.findUnique({ where: { id } })
    if (!existing) return badRequest("Contact not found")

    const updated = await prisma.whatsAppGatewayContact.update({
      where: { id },
      data: {
        name: parsed.data.name !== undefined ? parsed.data.name || null : undefined,
        email: parsed.data.email !== undefined ? parsed.data.email || null : undefined,
      },
    })
    return NextResponse.json({ ok: true, contact: { id: updated.id, name: updated.name, email: updated.email } }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}