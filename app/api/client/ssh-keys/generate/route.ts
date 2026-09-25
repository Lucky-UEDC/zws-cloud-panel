import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromRequest } from "@/lib/server-auth"
import { execFile } from "child_process"
import { promisify } from "util"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { parseSshPublicKey } from "@/lib/ssh-keys"
import { encryptVaultSecret } from "@/lib/crypto/secret-vault"
import { writeAuditLog } from "@/lib/audit-log"

const execFilePromise = promisify(execFile)

function defaultKeyName() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")
  return `zws-key-${stamp.slice(0, 8)}-${stamp.slice(8)}`
}

function safeFilename(name: string) {
  return `cloud-${name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "ssh-key"}.pem`
}

export async function POST(req: NextRequest) {
  const session = await getClientFromRequest(req)
  if (!session?.sub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await req.json().catch(() => ({}))
    const { save, label, name, isDefault } = body
    const keyName = String(label || name || defaultKeyName()).trim()
    const shouldSave = save !== false

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zws-ssh-"))
    try {
      const privateKeyPath = path.join(tmpDir, "id_ed25519")
      const publicKeyPath = path.join(tmpDir, "id_ed25519.pub")

      await execFilePromise("ssh-keygen", ["-q", "-t", "ed25519", "-f", privateKeyPath, "-N", "", "-C", keyName])

      const privateKey = await fs.readFile(privateKeyPath, "utf8")
      const publicKey = await fs.readFile(publicKeyPath, "utf8")
      const parsed = parseSshPublicKey(publicKey)
      const encryptedPrivateKey = encryptVaultSecret(privateKey)

      let savedKeyId = null
      if (shouldSave) {
        const existing = await prisma.sshKey.findFirst({
          where: { customerId: String(session.sub), fingerprint: parsed.fingerprint },
          select: { id: true },
        })
        if (existing) {
          savedKeyId = existing.id
        } else {
          const key = await prisma.$transaction(async (tx) => {
            if (isDefault) {
              await tx.sshKey.updateMany({ where: { customerId: String(session.sub) }, data: { isDefault: false } })
            }
            return tx.sshKey.create({
              data: {
                customerId: String(session.sub),
                label: keyName,
                publicKey: parsed.publicKey,
                privateKeyEnc: encryptedPrivateKey.ciphertext,
                privateKeyIv: encryptedPrivateKey.iv,
                privateKeyTag: encryptedPrivateKey.tag,
                fingerprint: parsed.fingerprint,
                type: parsed.type,
                source: "generated",
                isDefault: Boolean(isDefault),
              },
            })
          })
          savedKeyId = key.id
          await writeAuditLog({
            action: "ssh_key_generated",
            customerId: String(session.sub),
            actorEmail: session.email || null,
            targetType: "ssh_key",
            targetId: key.id,
            metadata: { fingerprint: key.fingerprint, type: key.type, source: "generated" },
            ipAddress: req.headers.get("x-forwarded-for") || null,
            userAgent: req.headers.get("user-agent") || null,
          })
        }
      }

      return NextResponse.json({
        success: true,
        id: savedKeyId,
        keyId: savedKeyId,
        name: keyName,
        label: keyName,
        publicKey: parsed.publicKey,
        privateKey,
        fingerprint: parsed.fingerprint,
        filename: safeFilename(keyName),
        savedKeyId,
      })
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  } catch (e: any) {
    console.error("SSH Generation Error:", e?.message || e)
    return NextResponse.json({ error: "Failed to generate SSH keypair" }, { status: 500 })
  }
}
