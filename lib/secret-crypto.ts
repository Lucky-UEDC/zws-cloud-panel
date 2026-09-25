import crypto from "node:crypto"
import { requireSecret } from "@/lib/security/env-secret"

const LEGACY_PREFIX = "enc:v1:"
const PREFIX = "enc:v2:"

function legacySecretKey() {
  return crypto.createHash("sha256").update(requireSecret(["JWT_SECRET"], "zws-fallback-secret")).digest()
}

function secretKey() {
  const raw = String(process.env.ENCRYPTION_KEY || process.env.SECRET_ENCRYPTION_KEY || "").trim()
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_KEY is required for encrypted secret storage in production.")
    }
    return crypto.createHash("sha256").update("zws-development-secret-encryption-key").digest()
  }

  if (/^[a-f0-9]{64}$/i.test(raw)) {
    const key = Buffer.from(raw, "hex")
    if (key.length === 32) return key
  }

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    const key = Buffer.from(raw, "base64")
    if (key.length === 32) return key
  }

  throw new Error("ENCRYPTION_KEY must be a 32-byte hex or base64 value.")
}

export function encryptSecretValue(value: string): string {
  if (!value) return ""
  if (isEncryptedSecret(value)) return value
  const key = secretKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${[iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":")}`
}

export function decryptSecretValue(value: string): string {
  const raw = String(value || "")
  if (!raw) return ""
  const legacy = raw.startsWith(LEGACY_PREFIX)
  const encrypted = raw.startsWith(PREFIX)
    ? raw.slice(PREFIX.length)
    : legacy
      ? raw.slice(LEGACY_PREFIX.length)
      : raw
  const [ivBase64, tagBase64, encryptedBase64] = encrypted.split(":")
  if (!ivBase64 || !tagBase64 || !encryptedBase64) return raw
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", legacy ? legacySecretKey() : secretKey(), Buffer.from(ivBase64, "base64"))
    decipher.setAuthTag(Buffer.from(tagBase64, "base64"))
    const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedBase64, "base64")), decipher.final()])
    return decrypted.toString("utf8")
  } catch {
    return raw
  }
}

export function isEncryptedSecret(value: string) {
  const raw = String(value || "")
  return raw.startsWith(PREFIX) || raw.startsWith(LEGACY_PREFIX)
}
