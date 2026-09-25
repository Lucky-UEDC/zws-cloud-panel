import { sendEmail } from "@/lib/mailer"
import { recordEmailLog } from "@/lib/email/log"
import { defaultTemplateVariables, getEmailTemplate, renderTemplateSource, type EmailTemplateVariables } from "@/lib/email/templates"
import type { SendMailInput } from "@/lib/email/send"

export { recordEmailLog }

export async function sendTemplateEmail(input: {
  templateKey: string
  to: string | string[]
  variables?: EmailTemplateVariables
  throwOnError?: boolean
  attachments?: SendMailInput["attachments"]
  customerId?: string | null
  orderId?: string | null
  invoiceId?: string | null
  vpsInstanceId?: string | null
  paymentId?: string | null
  metadata?: Record<string, unknown>
}) {
  const template = await getEmailTemplate(input.templateKey)
  const recipients = Array.isArray(input.to) ? input.to : [input.to]
  const variables = await defaultTemplateVariables(input.variables || {})

  if (!template) {
    await recordEmailLog({ templateKey: input.templateKey, recipient: recipients, subject: input.templateKey, status: "failed", error: "Template not found", customerId: input.customerId, orderId: input.orderId, invoiceId: input.invoiceId, attachmentCount: input.attachments?.length || 0, metadata: input.metadata })
    if (input.throwOnError) throw new Error("Template not found")
    return { success: false as const, status: "failed" as const, error: "Template not found" }
  }

  const rendered = renderTemplateSource(template, variables)
  if (!template.enabled) {
    await recordEmailLog({ templateKey: template.key, recipient: recipients, subject: rendered.subject, status: "skipped", error: "Template disabled", customerId: input.customerId, orderId: input.orderId, invoiceId: input.invoiceId, attachmentCount: input.attachments?.length || 0, metadata: input.metadata })
    return { success: false as const, status: "skipped" as const, message: "Template disabled" }
  }

  return sendEmail({
    to: recipients,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    templateKey: template.key,
    logMessage: `template_${template.key}_sent`,
    throwOnError: input.throwOnError,
    attachments: input.attachments,
    customerId: input.customerId,
    orderId: input.orderId,
    invoiceId: input.invoiceId,
    vpsInstanceId: input.vpsInstanceId,
    paymentId: input.paymentId,
    metadata: input.metadata,
  })
}
