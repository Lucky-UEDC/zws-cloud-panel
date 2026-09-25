import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { sendEmail } from "@/lib/mailer"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { serializeTicket } from "@/lib/ticket-attachments"
import { requireSameOriginOrCsrf } from "@/lib/auth/guards"
import { securityGate } from "@/lib/security/forms"

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params

  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, email: true, name: true } },
      messages: { orderBy: { createdAt: "asc" }, include: { attachments: true } },
    },
  })

  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
  return NextResponse.json({ ticket: serializeTicket(ticket) })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await securityGate(request)
  if (!gate.ok) return gate.response
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  const body = (await request.json()) as { status?: string; priority?: string; category?: string; assignedAdminId?: string | null }
  const allowedStatus = new Set(["open", "pending", "resolved", "closed"])
  const allowedPriority = new Set(["low", "medium", "high", "urgent"])
  const status = body.status && allowedStatus.has(String(body.status)) ? String(body.status) : undefined
  const priority = body.priority && allowedPriority.has(String(body.priority)) ? String(body.priority) : undefined

  const existing = await prisma.supportTicket.findUnique({
    where: { id },
    include: { customer: true },
  })
  if (!existing) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })

  const ticket = await prisma.supportTicket.update({
    where: { id },
    data: {
      status,
      priority,
      category: body.category,
      assignedAdminId: body.assignedAdminId === undefined ? undefined : body.assignedAdminId || null,
      closedAt: status === "closed" ? new Date() : null,
    },
  })

  if (status && status !== existing.status) {
    try {
      await sendEmail({
        to: existing.customer.email,
        subject: `[${existing.ticketNumber}] Status updated to ${status}`,
        text: `Your ticket status changed from ${existing.status} to ${status}.`,
      })
    } catch {
      // Do not fail on SMTP errors.
    }
  }

  return NextResponse.json({ success: true, ticket: serializeTicket(ticket) })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await securityGate(request)
  if (!gate.ok) return gate.response
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params

  try {
    // Explicitly delete messages first to avoid foreign key constraints if not cascading
    await (prisma as any).supportTicketAttachment.deleteMany({
      where: { ticketId: id },
    }).catch(() => null)
    await prisma.supportTicketMessage.deleteMany({
      where: { ticketId: id },
    })
    await prisma.supportTicket.delete({
      where: { id },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[ADMIN_TICKETS_DELETE]", error)
    return NextResponse.json({ error: "Failed to delete ticket" }, { status: 500 })
  }
}
