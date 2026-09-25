import crypto from "node:crypto"
import { requireSecret } from "@/lib/security/env-secret"

function secret() {
  return requireSecret(["INVOICE_SHARE_SECRET", "JWT_SECRET"], "zws-invoice-share-dev-secret")
}

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url")
}

function sign(payload: string) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url")
}

function invoiceShareEnabled(invoice: any) {
  const metadata = invoice?.metadata && typeof invoice.metadata === "object" && !Array.isArray(invoice.metadata)
    ? invoice.metadata as Record<string, any>
    : {}
  return Boolean(metadata.publicShareEnabled || metadata.invoicePublicShareEnabled)
}

export function createInvoiceShareToken(input: { invoiceId: string; invoiceNumber: string; expiresAt: Date }) {
  const payload = base64Url(JSON.stringify({
    invoiceId: input.invoiceId,
    invoiceNumber: input.invoiceNumber,
    exp: Math.floor(input.expiresAt.getTime() / 1000),
  }))
  return `${payload}.${sign(payload)}`
}

export function verifyInvoiceShareToken(invoice: any, token: string | null | undefined) {
  if (!invoiceShareEnabled(invoice)) return false
  const [payload, signature, extra] = String(token || "").split(".")
  if (!payload || !signature || extra) return false
  const expected = sign(payload)
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return false

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as any
    if (String(parsed.invoiceId || "") !== String(invoice.id || "")) return false
    if (String(parsed.invoiceNumber || "") !== String(invoice.invoiceNumber || "")) return false
    if (Number(parsed.exp || 0) <= Math.floor(Date.now() / 1000)) return false
    return true
  } catch {
    return false
  }
}
