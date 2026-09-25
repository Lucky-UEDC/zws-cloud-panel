import { NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"

function isWindowsOs(vps: any) {
  const text = [
    vps?.operatingSystem?.name,
    vps?.operatingSystem?.slug,
    vps?.operatingSystem?.osType,
    vps?.operatingSystem?.category,
    vps?.operatingSystem?.proxmoxTemplateName,
    vps?.order?.osName,
  ].filter(Boolean).join(" ").toLowerCase()
  return text.includes("windows") || /\bwin(?:dows)?\b/.test(text)
}

function safeFilename(value: unknown) {
  const name = String(value || "server").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return `${name || "server"}.rdp`
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const vps = await prisma.vpsInstance.findFirst({
    where: {
      OR: [{ id }, { orderId: id }],
      customerId,
      deletedAt: null,
      status: { not: "DELETED" },
      order: { deletedAt: null, status: { not: "DELETED" } },
    },
    include: {
      order: { select: { osName: true } },
      operatingSystem: { select: { name: true, slug: true, osType: true, category: true, proxmoxTemplateName: true } },
    },
  })
  if (!vps) return NextResponse.json({ success: false, error: "Instance not found" }, { status: 404 })
  if (!isWindowsOs(vps)) return NextResponse.json({ success: false, error: "RDP is only available for Windows VPS instances" }, { status: 404 })
  if (!vps.ipAddress) return NextResponse.json({ success: false, error: "Public IP is not assigned yet" }, { status: 409 })

  const username = String(vps.username || vps.adminUsername || "Administrator")
  const content = [
    `full address:s:${vps.ipAddress}`,
    `username:s:${username}`,
    "prompt for credentials:i:1",
    "administrative session:i:0",
    "screen mode id:i:2",
    "use multimon:i:0",
    "desktopwidth:i:1920",
    "desktopheight:i:1080",
    "session bpp:i:32",
    "compression:i:1",
    "keyboardhook:i:2",
    "audiocapturemode:i:0",
    "audiomode:i:0",
    "redirectclipboard:i:1",
    "redirectprinters:i:0",
    "redirectcomports:i:0",
    "redirectsmartcards:i:0",
    "redirectwebauthn:i:0",
    "drivestoredirect:s:",
    "enablecredsspsupport:i:1",
    "authentication level:i:2",
    "negotiate security layer:i:1",
    "",
  ].join("\r\n")

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": "application/x-rdp",
      "Content-Disposition": `attachment; filename="${safeFilename(vps.name)}"`,
      "Cache-Control": "no-store",
    },
  })
}
