import crypto from "node:crypto"

export type EncryptedSecret = {
  ciphertext: string
  iv: string
  tag: string
}

function parseSecretEncryptionKey() {
  const raw = String(process.env.ENCRYPTION_KEY || process.env.SECRET_ENCRYPTION_KEY || "").trim()
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_KEY is required in production.")
    }
    return crypto.createHash("sha256").update("zws-development-secret-encryption-key").digest()
  }

  const hex = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : null
  if (hex?.length === 32) return hex

  const base64 = /^[A-Za-z0-9+/]+={0,2}$/.test(raw) ? Buffer.from(raw, "base64") : null
  if (base64?.length === 32) return base64

  throw new Error("ENCRYPTION_KEY must be a 32-byte hex or base64 value.")
}

export function encryptVaultSecret(value: string): EncryptedSecret {
  const key = parseSecretEncryptionKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  }
}

export function decryptVaultSecret(input: EncryptedSecret): string {
  const key = parseSecretEncryptionKey()
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(input.iv, "base64"))
  decipher.setAuthTag(Buffer.from(input.tag, "base64"))
  const decrypted = Buffer.concat([decipher.update(Buffer.from(input.ciphertext, "base64")), decipher.final()])
  return decrypted.toString("utf8")
}
