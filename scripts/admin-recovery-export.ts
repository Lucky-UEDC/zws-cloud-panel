import crypto from "node:crypto"
import { mkdir, writeFile, chmod } from "node:fs/promises"
import path from "node:path"
import { prisma } from "@/lib/db"
import { normalizeStaffRole } from "@/lib/roles"
import type { MfaSubject } from "@/lib/auth/mfa/types"
import { regenerateRecoveryCodesForSubject } from "@/lib/auth/mfa/totp"
import { logSecurityEvent } from "@/lib/auth/mfa/events"

const OUT_DIR = process.env.ADMIN_RECOVERY_EXPORT_DIR || "/storage/recovery"
const ALGORITHM = "aes-256-gcm"

function usage() {
  console.error("Usage: pnpm tsx scripts/admin-recovery-export.ts <admin-email>")
}

function key() {
  const material = process.env.AUTH_SECRET || process.env.MFA_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET
  if (!material) throw new Error("AUTH_SECRET, MFA_ENCRYPTION_KEY, or NEXTAUTH_SECRET is required for encrypted export.")
  return crypto.createHash("sha256").update(material).digest()
}

function encryptJson(payload: unknown) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload, null, 2), "utf8"), cipher.final()])
  return {
    algorithm: ALGORITHM,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: encrypted.toString("base64url"),
  }
}

function safeName(email: string) {
  return email.toLowerCase().replace(/[^a-z0-9._-]+/g, "_")
}

async function main() {
  const email = String(process.argv[2] || "").trim().toLowerCase()
  if (!email) {
    usage()
    process.exit(1)
  }

  const admin = await prisma.adminProfile.findUnique({ where: { email } })
  if (!admin?.isActive) throw new Error(`Active admin not found: ${email}`)
  const subject: MfaSubject = {
    userType: "admin",
    userId: admin.id,
    role: normalizeStaffRole(admin.role) || "admin",
    email: admin.email,
    name: admin.displayName,
    phone: (admin as any).whatsappMfaEnabled && (admin as any).phoneVerified ? (admin as any).phone : null,
    phoneVerified: (admin as any).phoneVerified,
    hashedPassword: admin.hashedPassword,
    legacyTotpEnabled: admin.twoFactorEnabled,
    legacyTotpSecret: admin.twoFactorSecret,
    legacyBackupCodes: admin.twoFactorBackupCodes,
  }

  const codes = await regenerateRecoveryCodesForSubject(subject)
  const regenerated = true

  await mkdir(OUT_DIR, { recursive: true, mode: 0o700 })
  await chmod(OUT_DIR, 0o700).catch(() => null)

  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60_000)
  const stamp = createdAt.toISOString().replace(/[:.]/g, "-")
  const base = `${safeName(admin.email)}-${stamp}-recovery-codes`
  const txtPath = path.join(OUT_DIR, `${base}.txt`)
  const printPath = path.join(OUT_DIR, `${base}.print.txt`)
  const jsonPath = path.join(OUT_DIR, `${base}.encrypted.json`)

  const header = [
    "ZWS admin recovery codes",
    `Admin: ${admin.email}`,
    `Generated: ${createdAt.toISOString()}`,
    `Export expires: ${expiresAt.toISOString()}`,
    `Regenerated: ${regenerated ? "yes" : "no"}`,
    "",
  ].join("\n")
  const txt = `${header}${codes.join("\n")}\n`
  const printable = `${header}${codes.map((code: string, index: number) => `${String(index + 1).padStart(2, "0")}. ${code}`).join("\n")}\n`
  const encrypted = encryptJson({
    adminEmail: admin.email,
    adminId: admin.id,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    regenerated,
    codes,
  })

  await writeFile(txtPath, txt, { mode: 0o600 })
  await writeFile(printPath, printable, { mode: 0o600 })
  await writeFile(jsonPath, `${JSON.stringify(encrypted, null, 2)}\n`, { mode: 0o600 })
  await Promise.all([chmod(txtPath, 0o600), chmod(printPath, 0o600), chmod(jsonPath, 0o600)]).catch(() => null)

  await logSecurityEvent({
    userType: "admin",
    userId: admin.id,
    eventType: "admin_recovery_codes_exported",
    metadata: { paths: [txtPath, printPath, jsonPath], regenerated, expiresAt: expiresAt.toISOString() },
  })

  console.log(JSON.stringify({ success: true, admin: admin.email, regenerated, paths: { txtPath, printPath, jsonPath }, expiresAt: expiresAt.toISOString() }, null, 2))
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null)
  })
