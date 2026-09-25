import { NextRequest, NextResponse } from "next/server"
import { Readable } from "node:stream"
import { prisma } from "@/lib/db"
import { getAdminFromRequest, getClientFromRequest } from "@/lib/server-auth"
import { openAttachmentStream } from "@/lib/ticket-attachments"

export const dynamic = "force-dynamic"

function disposition(name: string, inline: boolean) {
  const safe = String(name || "attachment").replace(/["\r\n]/g, "_")
  return `${inline ? "inline" : "attachment"}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [admin, client] = await Promise.all([
    getAdminFromRequest(request).catch(() => null),
    getClientFromRequest(request).catch(() => null),
  ])
  if (!admin?.email && !client?.sub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const attachment = await (prisma as any).supportTicketAttachment.findFirst({
    where: { id, deletedAt: null },
    include: { ticket: { select: { customerId: true } } },
  }).catch(() => null)
  if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 })
  if (!admin?.email && String(attachment.ticket?.customerId || "") !== String(client?.sub || "")) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 })
  }

  try {
    const opened = await openAttachmentStream(attachment)
    const inline = request.nextUrl.searchParams.get("preview") === "1"
    const stream = Readable.toWeb(opened.stream) as ReadableStream
    opened.stream.once("close", () => void opened.cleanup())
    return new NextResponse(stream, {
      headers: {
        "Content-Type": attachment.mimeType || "application/octet-stream",
        "Content-Length": String(opened.size),
        "Content-Disposition": disposition(attachment.originalName, inline),
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data: blob:; style-src 'none'; script-src 'none'; sandbox",
      },
    })
  } catch (error) {
    console.error("[ticket_attachment_stream_failed]", error)
    return NextResponse.json({ error: "Attachment is temporarily unavailable" }, { status: 503 })
  }
}
