import crypto from "node:crypto"
import { requireSecret } from "@/lib/security/env-secret"

const ALGORITHM = "aes-256-gcm"

function secretMaterial() {
  return requireSecret(["MFA_ENCRYPTION_KEY", "AUTH_SECRET", "NEXTAUTH_SECRET"], "zws-development-secret")
}

function key() {
  return crypto.createHash("sha256").update(secretMaterial()).digest()
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".")
}

export function decryptSecret(value: string) {
  const [ivText, tagText, encryptedText] = String(value || "").split(".")
  if (!ivText || !tagText || !encryptedText) throw new Error("Invalid encrypted secret")
  const decipher = crypto.createDecipheriv(ALGORITHM, key(), Buffer.from(ivText, "base64url"))
  decipher.setAuthTag(Buffer.from(tagText, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}

export function hashMfaValue(...parts: Array<string | null | undefined>) {
  return crypto.createHash("sha256").update(parts.map((part) => String(part || "")).join(":")).digest("hex")
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url")
}

export function generateOtp() {
  return String(crypto.randomInt(100000, 1000000))
}

export function generateRecoveryCode() {
  return `${crypto.randomBytes(3).toString("hex")}-${crypto.randomBytes(3).toString("hex")}`.toUpperCase()
}

