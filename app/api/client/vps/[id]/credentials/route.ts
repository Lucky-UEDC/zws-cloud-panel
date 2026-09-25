import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { decryptSecret } from "@/lib/provision"
import { writeAuditLog } from "@/lib/audit-log"
import { instanceDisplayName, internalVmHostname } from "@/lib/vm-hostname"

function safeDecrypt(value?: string | null) {
  if (!value) return null
  try {
    return decryptSecret(value)
  } catch {
    return null
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")
  const userAgent = request.headers.get("user-agent")
  if (!customerId) {
    await writeAuditLog({
      action: "client_console_credentials_denied",
      targetType: "vps",
      targetId: id,
      metadata: { reason: "unauthorized" },
      ipAddress,
      userAgent,
    })
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const reveal = request.nextUrl.searchParams.get("reveal") === "1"
  const vps = await prisma.vpsInstance.findFirst({
    where: { OR: [{ id }, { orderId: id }], customerId, deletedAt: null, status: { not: "DELETED" }, order: { deletedAt: null, status: { not: "DELETED" } } },
    include: { operatingSystem: true, order: { select: { osName: true } } },
  })
  if (!vps) {
    await writeAuditLog({
      action: "client_console_credentials_denied",
      customerId,
      targetType: "vps",
      targetId: id,
      metadata: { reason: "instance_not_found", reveal },
      ipAddress,
      userAgent,
    })
    return NextResponse.json({ success: false, error: "Instance not found" }, { status: 404 })
  }
  const osText = `${vps.operatingSystem?.name || ""} ${vps.operatingSystem?.osType || ""} ${vps.operatingSystem?.category || ""} ${vps.order.osName || ""}`
  const username = vps.username || vps.adminUsername || (/windows/i.test(osText) ? "Administrator" : "root")
  const password = safeDecrypt(vps.passwordEncrypted)
  if (reveal) {
    await writeAuditLog({
      action: "client_console_credentials_revealed",
      customerId,
      targetType: "vps",
      targetId: vps.id,
      metadata: { hasPassword: Boolean(password), surface: "console" },
      ipAddress,
      userAgent,
    })
  }
  return NextResponse.json({
    success: true,
    ip: vps.ipAddress || null,
    username,
    password: reveal ? password : null,
    passwordAvailable: Boolean(password),
    hostname: instanceDisplayName(vps),
    internalHostname: internalVmHostname(vps, vps.ipAddress || null),
    verification: {
      status: (vps as any).credentialVerificationStatus || null,
      label: (vps as any).credentialVerificationStatus === "VERIFIED" ? "Verified" : (vps as any).credentialVerificationStatus === "FAILED" ? "Verification Failed" : null,
      checkedAt: (vps as any).credentialVerificationCheckedAt || null,
      verifiedAt: (vps as any).credentialVerifiedAt || null,
    },
  })
}
