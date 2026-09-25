import { prisma } from "@/lib/db"

export type EmailStatus = "sent" | "failed" | "skipped"

export async function recordEmailLog(input: {
  templateKey?: string | null
  recipient: string | string[]
  subject: string
  status: EmailStatus
  provider?: string
  error?: string | null
  userId?: string | null
  customerId?: string | null
  orderId?: string | null
  invoiceId?: string | null
  attachmentCount?: number
  metadata?: Record<string, unknown>
}) {
  const recipients = Array.isArray(input.recipient) ? input.recipient : [input.recipient]
  await Promise.all(recipients.map((recipient) => prisma.emailLog.create({
    data: {
      templateKey: input.templateKey || null,
      recipient,
      subject: input.subject,
      status: input.status,
      provider: input.provider || "smtp",
      error: input.error || null,
      metadata: {
        ...(input.metadata || {}),
        userId: input.userId || input.customerId || null,
        customerId: input.customerId || input.userId || null,
        orderId: input.orderId || null,
        invoiceId: input.invoiceId || null,
        attachmentCount: Number(input.attachmentCount || 0),
      } as any,
    },
  }).catch(() => null)))
}
