import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromCookies } from "@/lib/server-auth"
import { serializeTicket } from "@/lib/ticket-attachments"

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const client = await getClientFromCookies()
  if (!client?.sub || !client.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  const ticket = await prisma.supportTicket.findFirst({
    where: { id, customerId: String(client.sub) },
    include: { messages: { orderBy: { createdAt: "asc" }, include: { attachments: true } } },
  })

  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
  return NextResponse.json({ ticket: serializeTicket(ticket) })
}
