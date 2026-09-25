import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromRequest } from "@/lib/server-auth"
import { writeAuditLog } from "@/lib/audit-log"

function serializeKey(key: any) {
  return {
    id: key.id,
    label: key.label,
    name: key.label,
    publicKey: key.publicKey,
    fingerprint: key.fingerprint,
    type: key.type,
    source: key.source,
    isDefault: key.isDefault,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getClientFromRequest(req)
  if (!session?.sub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id } = await params
    const key = await prisma.sshKey.findUnique({ where: { id } })

    if (!key) return NextResponse.json({ error: "SSH key not found" }, { status: 404 })
    if (key.customerId !== String(session.sub)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const activeJobs = await prisma.provisioningJob.count({
      where: {
        status: { in: ["queued", "running"] },
        order: { is: { sshKeyId: id } },
      },
    })
    if (activeJobs > 0) {
      return NextResponse.json({ error: "This SSH key is attached to an active provisioning job." }, { status: 409 })
    }

    await prisma.sshKey.delete({ where: { id } })
    await writeAuditLog({
      action: "ssh_key_deleted",
      customerId: String(session.sub),
      actorEmail: session.email || null,
      targetType: "ssh_key",
      targetId: id,
      oldValue: { label: key.label, fingerprint: key.fingerprint, type: key.type, source: key.source },
      ipAddress: req.headers.get("x-forwarded-for") || null,
      userAgent: req.headers.get("user-agent") || null,
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getClientFromRequest(req)
  if (!session?.sub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id } = await params
    const body = await req.json()
    const { label, name, isDefault } = body

    const key = await prisma.sshKey.findUnique({ where: { id } })
    if (!key) return NextResponse.json({ error: "SSH key not found" }, { status: 404 })
    if (key.customerId !== String(session.sub)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const updatedKey = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.sshKey.updateMany({
          where: { customerId: String(session.sub) },
          data: { isDefault: false },
        })
      }
      return tx.sshKey.update({
        where: { id },
        data: {
          ...(label !== undefined || name !== undefined ? { label: String(label ?? name).trim() } : {}),
          ...(isDefault !== undefined ? { isDefault: Boolean(isDefault) } : {}),
        },
      })
    })
    await writeAuditLog({
      action: label !== undefined || name !== undefined ? "ssh_key_renamed" : "ssh_key_updated",
      customerId: String(session.sub),
      actorEmail: session.email || null,
      targetType: "ssh_key",
      targetId: id,
      oldValue: { label: key.label, isDefault: key.isDefault },
      newValue: { label: updatedKey.label, isDefault: updatedKey.isDefault },
      ipAddress: req.headers.get("x-forwarded-for") || null,
      userAgent: req.headers.get("user-agent") || null,
    })

    return NextResponse.json(serializeKey(updatedKey))
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
