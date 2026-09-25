import crypto from "node:crypto"
import { prisma } from "@/lib/db"

export function createBridgeToken() {
  return crypto.randomBytes(32).toString("base64url")
}

export function hashBridgeToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

export async function issuePaymentBridgeToken(paymentAttemptId: string) {
  const token = createBridgeToken()
  await prisma.paymentBridgeToken.create({
    data: {
      tokenHash: hashBridgeToken(token),
      paymentAttemptId,
      expiresAt: new Date(Date.now() + 20 * 60_000),
    },
  })
  return token
}

export async function consumePaymentBridgeToken(token: string) {
  const row = await prisma.paymentBridgeToken.findUnique({
    where: { tokenHash: hashBridgeToken(token) },
    include: {
      paymentAttempt: {
        include: {
          gatewayConfig: true,
          domain: true,
          order: { include: { customer: true } },
        },
      },
    },
  })
  if (!row || row.consumedAt || row.expiresAt.getTime() < Date.now()) return null
  await prisma.paymentBridgeToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } })
  return row.paymentAttempt
}
