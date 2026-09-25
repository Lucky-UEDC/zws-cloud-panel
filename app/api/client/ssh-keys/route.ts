import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromRequest } from "@/lib/server-auth"
import { parseSshPublicKey } from "@/lib/ssh-keys"
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

export async function GET(req: NextRequest) {
  const session = await getClientFromRequest(req)
  if (!session?.sub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const keys = await prisma.sshKey.findMany({
      where: { customerId: String(session.sub) },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    })
    return NextResponse.json({ keys: keys.map(serializeKey) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getClientFromRequest(req)
  if (!session?.sub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await req.json()
    const { label, name, publicKey, isDefault } = body
    const keyLabel = String(label || name || "").trim()

    if (!keyLabel || !publicKey) {
      return NextResponse.json({ error: "Key name and public key are required" }, { status: 400 })
    }

    let parsed
    try {
      parsed = parseSshPublicKey(publicKey)
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || "Invalid SSH public key" }, { status: 400 })
    }

    const duplicate = await prisma.sshKey.findFirst({
      where: { customerId: String(session.sub), fingerprint: parsed.fingerprint },
      select: { id: true },
    })
    if (duplicate) {
      return NextResponse.json({ error: "This SSH key is already saved to your account" }, { status: 409 })
    }

    const key = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.sshKey.updateMany({ where: { customerId: String(session.sub) }, data: { isDefault: false } })
      }
      return tx.sshKey.create({
        data: {
          customerId: String(session.sub),
          label: keyLabel,
          publicKey: parsed.publicKey,
          fingerprint: parsed.fingerprint,
          type: parsed.type,
          source: "uploaded",
          isDefault: Boolean(isDefault),
        },
      })
    })

    await writeAuditLog({
      action: "ssh_public_key_added",
      customerId: String(session.sub),
      actorEmail: session.email || null,
      targetType: "ssh_key",
      targetId: key.id,
      metadata: { fingerprint: key.fingerprint, type: key.type, source: "uploaded" },
      ipAddress: req.headers.get("x-forwarded-for") || null,
      userAgent: req.headers.get("user-agent") || null,
    })

    return NextResponse.json(serializeKey(key))
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
