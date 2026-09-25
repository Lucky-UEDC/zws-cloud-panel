import { prisma } from "@/lib/db"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export const EMAIL_TEMPLATE_VARIABLES = [
  "brandName",
  "appUrl",
  "clientAreaUrl",
  "userName",
  "email",
  "orderId",
  "invoiceNumber",
  "dueDate",
  "amount",
  "currency",
  "productName",
  "serviceName",
  "cpu",
  "ram",
  "disk",
  "loginIp",
  "loginTime",
  "resetUrl",
  "verifyUrl",
  "paymentUrl",
  "serviceUrl",
  "deliverySlaHours",
  "primaryIp",
  "serverUsername",
  "temporaryPassword",
  "panelUrl",
  "supportUrl",
  "supportEmail",
  "billingEmail",
  "abuseEmail",
  "supportPhone",
  "whatsappNumber",
  "companyAddress",
  "websiteUrl",
  "legalCompanyName",
  "ticketUrl",
  "backupName",
  "backupSize",
  "backupStorage",
  "completedAt",
  "failureReason",
  "backupUrl",
] as const

export type EmailTemplateVariable = (typeof EMAIL_TEMPLATE_VARIABLES)[number]
export type EmailTemplateVariables = Partial<Record<EmailTemplateVariable, string | number | null | undefined>>

type TemplateCategory = "auth" | "billing" | "service" | "support" | "admin"
type TemplateGroup = "Account" | "Orders" | "Billing" | "Services" | "Support" | "Admin" | "Dedicated"

type DefaultTemplate = {
  key: string
  group: TemplateGroup
  category: TemplateCategory
  name: string
  subject: string
  preheader: string
  title: string
  message: string[]
  highlight?: Array<[string, string]>
  cta?: { label: string; url: string }
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function renderDefaultHtml(template: DefaultTemplate) {
  const message = template.message.map((line) => `<p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.65">${line}</p>`).join("")
  const highlight = template.highlight?.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;border-collapse:separate;border-spacing:0;background:#f8fafc;border:1px solid #dbe7ef;border-radius:12px;overflow:hidden">${template.highlight.map(([label, value]) => `<tr><td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0">${label}</td><td style="padding:12px 16px;color:#0f172a;font-size:14px;font-weight:700;text-align:right;border-bottom:1px solid #e2e8f0">${value}</td></tr>`).join("")}</table>`
    : ""
  const cta = template.cta
    ? `<a href="${template.cta.url}" style="display:inline-block;margin-top:8px;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 20px;border-radius:8px">${escapeHtml(template.cta.label)}</a>`
    : ""

  return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${template.subject}</title>
  </head>
  <body style="margin:0;padding:0;background:#eef5f8;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">{{preheader}}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef5f8;padding:28px 12px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #dbe7ef;border-radius:12px;overflow:hidden">
            <tr>
              <td style="padding:24px 28px;background:#071014">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="vertical-align:middle">
                      <span style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;border-radius:8px;background:#0f766e;color:#ffffff;font-weight:800">Z</span>
                      <span style="margin-left:10px;color:#ffffff;font-size:18px;font-weight:800;vertical-align:middle">{{brandName}}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:34px 28px 30px">
                <h1 style="margin:0 0 18px;color:#0f172a;font-size:28px;line-height:1.25;letter-spacing:0">${template.title}</h1>
                ${message}
                ${highlight}
                ${cta}
              </td>
            </tr>
            <tr>
              <td style="padding:22px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:13px;line-height:1.6">
                <p style="margin:0 0 8px">Need help? Contact <a href="mailto:{{supportEmail}}" style="color:#0f766e;text-decoration:none">{{supportEmail}}</a> or visit <a href="{{websiteUrl}}" style="color:#0f766e;text-decoration:none">{{websiteUrl}}</a>.</p>
                <p style="margin:0 0 8px">{{legalCompanyName}} · Professional cloud infrastructure</p>
                <p style="margin:0">This email contains account, billing, or service information for your {{brandName}} account.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function renderDefaultText(template: DefaultTemplate) {
  const highlight = template.highlight?.length
    ? ["", ...template.highlight.map(([label, value]) => `${label}: ${value}`), ""]
    : []
  return [
    template.title,
    "",
    ...template.message,
    ...highlight,
    template.cta ? `${template.cta.label}: ${template.cta.url}` : "",
    "",
    "Support: {{supportEmail}}",
    "Website: {{websiteUrl}}",
    "{{legalCompanyName}}",
  ].filter((line) => line !== undefined).join("\n")
}

function template(input: DefaultTemplate) {
  const { title: _title, message: _message, highlight: _highlight, cta: _cta, ...persisted } = input
  return {
    ...persisted,
    htmlBody: renderDefaultHtml(input),
    textBody: renderDefaultText(input),
  }
}

export const DEFAULT_EMAIL_TEMPLATES = [
  template({
    key: "account_created",
    group: "Account",
    category: "auth",
    name: "Account created",
    subject: "Welcome to {{brandName}} 🚀",
    preheader: "Your {{brandName}} account is ready.",
    title: "Welcome to {{brandName}}",
    message: ["Hi {{userName}},", "Your cloud account for {{email}} has been created. Verify your email to keep checkout and service updates secure."],
    highlight: [["Account email", "{{email}}"]],
    cta: { label: "Open Client Area", url: "{{clientAreaUrl}}" },
  }),
  template({
    key: "email_verification",
    group: "Account",
    category: "auth",
    name: "Email verification",
    subject: "Verify your email ✅",
    preheader: "Confirm your {{brandName}} email address.",
    title: "Verify your email ✅",
    message: ["Hi {{userName}},", "Confirm {{email}} so we can keep your account, checkout, and cloud service notifications secure."],
    highlight: [["Account email", "{{email}}"], ["Link expires", "24 hours"]],
    cta: { label: "Verify email", url: "{{verifyUrl}}" },
  }),
  template({
    key: "email_verified",
    group: "Account",
    category: "auth",
    name: "Email verified",
    subject: "Your email is verified ✅",
    preheader: "Your {{brandName}} email address is verified.",
    title: "Your email is verified ✅",
    message: ["Hi {{userName}},", "{{email}} is now verified for your {{brandName}} account."],
    highlight: [["Verified email", "{{email}}"]],
    cta: { label: "Open Client Area", url: "{{clientAreaUrl}}" },
  }),
  template({
    key: "login_alert",
    group: "Account",
    category: "auth",
    name: "Login alert",
    subject: "New login detected 🔐",
    preheader: "A new sign-in was detected on your account.",
    title: "New login detected 🔐",
    message: ["Hi {{userName}},", "We detected a new login to your {{brandName}} account."],
    highlight: [["IP address", "{{loginIp}}"], ["Time", "{{loginTime}}"]],
    cta: { label: "Review account", url: "{{clientAreaUrl}}" },
  }),
  template({
    key: "password_reset",
    group: "Account",
    category: "auth",
    name: "Password reset",
    subject: "Reset your password 🔑",
    preheader: "Use the secure link to reset your password.",
    title: "Reset your password 🔑",
    message: ["Hi {{userName}},", "A password reset was requested for {{email}}. Use the secure link below to continue."],
    highlight: [["Account", "{{email}}"]],
    cta: { label: "Reset password", url: "{{resetUrl}}" },
  }),
  template({
    key: "order_created",
    group: "Orders",
    category: "billing",
    name: "Order created",
    subject: "Order received 🧾",
    preheader: "We received your cloud server order.",
    title: "Order received 🧾",
    message: ["Hi {{userName}},", "We received your order for {{productName}} and are preparing the next step."],
    highlight: [["Order", "{{orderId}}"], ["Amount", "{{currency}} {{amount}}"]],
    cta: { label: "View order", url: "{{clientAreaUrl}}" },
  }),
  template({
    key: "order_pending_payment",
    group: "Orders",
    category: "billing",
    name: "Order pending payment",
    subject: "Payment pending ⏳",
    preheader: "Your order is waiting for payment completion.",
    title: "Payment pending ⏳",
    message: ["Hi {{userName}},", "Order {{orderId}} is waiting for payment. Complete payment to continue deployment."],
    highlight: [["Order", "{{orderId}}"], ["Amount", "{{currency}} {{amount}}"]],
    cta: { label: "Complete payment", url: "{{paymentUrl}}" },
  }),
  template({
    key: "order_paid",
    group: "Orders",
    category: "billing",
    name: "Order paid",
    subject: "Payment successful ✅",
    preheader: "Your payment was received successfully.",
    title: "Payment successful ✅",
    message: ["Hi {{userName}},", "Payment for order {{orderId}} was received successfully."],
    highlight: [["Order", "{{orderId}}"], ["Amount", "{{currency}} {{amount}}"]],
    cta: { label: "Open Client Area", url: "{{clientAreaUrl}}" },
  }),
  template({
    key: "payment_success",
    group: "Billing",
    category: "billing",
    name: "Payment success",
    subject: "Payment successful ✅",
    preheader: "Your payment was received successfully.",
    title: "Payment successful ✅",
    message: ["Hi {{userName}},", "We received your payment for {{invoiceNumber}}. Your invoice PDF is attached for your records."],
    highlight: [["Invoice", "{{invoiceNumber}}"], ["Amount", "{{currency}} {{amount}}"]],
    cta: { label: "View invoice", url: "{{paymentUrl}}" },
  }),
  template({
    key: "invoice_created",
    group: "Billing",
    category: "billing",
    name: "Invoice created",
    subject: "Invoice generated 🧾",
    preheader: "A new invoice is available in your account.",
    title: "Invoice generated 🧾",
    message: ["Hi {{userName}},", "Invoice {{invoiceNumber}} has been generated and is ready for review."],
    highlight: [["Invoice", "{{invoiceNumber}}"], ["Amount", "{{currency}} {{amount}}"]],
    cta: { label: "View invoice", url: "{{paymentUrl}}" },
  }),
  template({
    key: "invoice_paid",
    group: "Billing",
    category: "billing",
    name: "Invoice paid",
    subject: "Invoice paid ✅",
    preheader: "Your invoice payment has been recorded.",
    title: "Invoice paid ✅",
    message: ["Hi {{userName}},", "Invoice {{invoiceNumber}} has been paid successfully."],
    highlight: [["Invoice", "{{invoiceNumber}}"], ["Amount", "{{currency}} {{amount}}"]],
    cta: { label: "Open billing", url: "{{clientAreaUrl}}" },
  }),
  template({
    key: "renewal_invoice",
    group: "Billing",
    category: "billing",
    name: "Renewal invoice",
    subject: "Renewal invoice generated 🧾",
    preheader: "A renewal invoice is ready for payment.",
    title: "Renewal invoice generated 🧾",
    message: ["Hi {{userName}},", "Renewal invoice {{invoiceNumber}} is ready. Complete payment to keep {{serviceName}} active."],
    highlight: [["Invoice", "{{invoiceNumber}}"], ["Amount", "{{currency}} {{amount}}"]],
    cta: { label: "Pay renewal invoice", url: "{{paymentUrl}}" },
  }),
  template({
    key: "payment_failed",
    group: "Billing",
    category: "billing",
    name: "Payment failed",
    subject: "Payment failed ⚠️",
    preheader: "Your payment could not be completed.",
    title: "Payment failed ⚠️",
    message: ["Hi {{userName}},", "Payment for {{invoiceNumber}} could not be completed. You can retry payment from the invoice page."],
    highlight: [["Invoice", "{{invoiceNumber}}"], ["Amount", "{{currency}} {{amount}}"]],
    cta: { label: "Retry payment", url: "{{paymentUrl}}" },
  }),
  template({
    key: "service_provisioning",
    group: "Services",
    category: "service",
    name: "Service provisioning",
    subject: "Server deployment started ⚙️",
    preheader: "Your cloud server deployment has started.",
    title: "Server deployment started ⚙️",
    message: ["Hi {{userName}},", "Deployment has started for {{serviceName}}. We will notify you when it is active."],
    highlight: [["Service", "{{serviceName}}"], ["Order", "{{orderId}}"]],
    cta: { label: "Track deployment", url: "{{clientAreaUrl}}" },
  }),
  template({
    key: "service_active",
    group: "Services",
    category: "service",
    name: "Service active",
    subject: "Your cloud server is active 🚀",
    preheader: "Your server is active and ready.",
    title: "Your cloud server is active 🚀",
    message: ["Hi {{userName}},", "Your server {{serviceName}} is now active and ready."],
    highlight: [["CPU", "{{cpu}}"], ["RAM", "{{ram}}"], ["Storage", "{{disk}}"]],
    cta: { label: "Open Client Area", url: "{{clientAreaUrl}}" },
  }),
  template({
    key: "service_suspended",
    group: "Services",
    category: "service",
    name: "Service suspended",
    subject: "Service suspended ⚠️",
    preheader: "Your cloud service is currently suspended.",
    title: "Service suspended ⚠️",
    message: ["Hi {{userName}},", "{{serviceName}} has been suspended. Contact support if you need help restoring access."],
    highlight: [["Service", "{{serviceName}}"]],
    cta: { label: "Contact support", url: "{{supportUrl}}" },
  }),
  template({
    key: "service_cancelled",
    group: "Services",
    category: "service",
    name: "Service cancelled",
    subject: "Service cancelled",
    preheader: "Your cloud service was cancelled.",
    title: "Service cancelled",
    message: ["Hi {{userName}},", "{{serviceName}} has been cancelled."],
    highlight: [["Service", "{{serviceName}}"]],
    cta: { label: "Open Client Area", url: "{{clientAreaUrl}}" },
  }),
  template({
    key: "backup_completed",
    group: "Services",
    category: "service",
    name: "Backup completed",
    subject: "Backup completed ✅ {{serviceName}}",
    preheader: "Your server backup finished successfully.",
    title: "Backup completed ✅",
    message: ["Hi {{userName}},", "Your backup of {{serviceName}} completed successfully.", "The archive has been stored and verified."],
    highlight: [["Server", "{{serviceName}}"], ["Backup size", "{{backupSize}}"], ["Storage", "{{backupStorage}}"], ["Completed", "{{completedAt}}"]],
    cta: { label: "View backups", url: "{{backupUrl}}" },
  }),
  template({
    key: "backup_failed",
    group: "Services",
    category: "service",
    name: "Backup failed",
    subject: "Backup failed ⚠️ {{serviceName}}",
    preheader: "Your server backup could not be completed.",
    title: "Backup failed ⚠️",
    message: ["Hi {{userName}},", "Your backup of {{serviceName}} could not be completed.", "Reason: {{failureReason}}", "You can retry the backup from the client area."],
    highlight: [["Server", "{{serviceName}}"], ["Reason", "{{failureReason}}"]],
    cta: { label: "View backups", url: "{{backupUrl}}" },
  }),
  template({
    key: "refund_created",
    group: "Billing",
    category: "billing",
    name: "Refund created",
    subject: "Refund initiated 💸",
    preheader: "Your refund has been created.",
    title: "Refund initiated 💸",
    message: ["Hi {{userName}},", "A refund has been created for {{invoiceNumber}}."],
    highlight: [["Invoice", "{{invoiceNumber}}"], ["Amount", "{{currency}} {{amount}}"]],
    cta: { label: "View billing", url: "{{clientAreaUrl}}" },
  }),
  template({
    key: "support_ticket_created",
    group: "Support",
    category: "support",
    name: "Support ticket created",
    subject: "Support ticket opened 🎫",
    preheader: "We received your support request.",
    title: "Support ticket opened 🎫",
    message: ["Hi {{userName}},", "We received your support request. Our team will respond as soon as possible."],
    highlight: [["Ticket", "{{ticketUrl}}"]],
    cta: { label: "View ticket", url: "{{ticketUrl}}" },
  }),
  template({
    key: "support_reply",
    group: "Support",
    category: "support",
    name: "Support reply",
    subject: "New support reply 💬",
    preheader: "A support team member replied to your ticket.",
    title: "New support reply 💬",
    message: ["Hi {{userName}},", "A support team member replied to your ticket."],
    highlight: [["Ticket", "{{ticketUrl}}"]],
    cta: { label: "View reply", url: "{{ticketUrl}}" },
  }),
  template({
    key: "login_otp",
    group: "Account",
    category: "auth",
    name: "Login verification code",
    subject: "Your {{brandName}} login code",
    preheader: "Use this code to complete sign in.",
    title: "Login verification code",
    message: ["Hi {{userName}},", "Use the one-time code for {{email}} to complete your login."],
    highlight: [["Account", "{{email}}"]],
  }),
  template({
    key: "admin_new_order",
    group: "Admin",
    category: "admin",
    name: "Admin new order",
    subject: "New order {{orderId}}",
    preheader: "A new order was created.",
    title: "New order received",
    message: ["A new order was created on {{brandName}}."],
    highlight: [["Order", "{{orderId}}"], ["Product", "{{productName}}"], ["Amount", "{{currency}} {{amount}}"]],
  }),
] as const

export const SAMPLE_TEMPLATE_VARIABLES: Required<Record<EmailTemplateVariable, string>> = {
  brandName: "Cloud",
  appUrl: "https://example.com",
  clientAreaUrl: "https://example.com/client-area",
  userName: "Demo User",
  email: "demo@example.com",
  orderId: "ORD-1001",
  invoiceNumber: "INV-1001",
  dueDate: "15 May 2026",
  amount: "2499.00",
  currency: "INR",
  productName: "Cloud Compute Instance",
  serviceName: "demo-vps-01",
  cpu: "4 vCPU",
  ram: "16 GB",
  disk: "160 GB NVMe",
  loginIp: "203.0.113.10",
  loginTime: new Date().toLocaleString("en-IN"),
  resetUrl: "https://example.com/reset-password?token=sample",
  verifyUrl: "https://example.com/verify-email?token=sample",
  paymentUrl: "https://example.com/client-area/billing",
  serviceUrl: "https://example.com/client-area/dedicated/demo",
  deliverySlaHours: "72",
  primaryIp: "203.0.113.20",
  serverUsername: "root",
  temporaryPassword: "temporary-password",
  panelUrl: "https://203.0.113.20",
  supportUrl: "https://example.com/support",
  supportEmail: "support@example.com",
  billingEmail: "billing@example.com",
  abuseEmail: "abuse@example.com",
  supportPhone: "+91 00000 00000",
  whatsappNumber: "+91 00000 00000",
  companyAddress: "Example Business Address",
  websiteUrl: "https://example.com",
  legalCompanyName: "Cloud Services",
  ticketUrl: "https://example.com/client-area/support",
  backupName: "My server backup",
  backupSize: "1.2 GB",
  backupStorage: "Example Storage",
  completedAt: "2026-09-23 12:00 UTC",
  failureReason: "Example failure reason",
  backupUrl: "https://example.com/client-area/backups",
}

function interpolate(source: string, variables: EmailTemplateVariables) {
  return String(source || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    if (key === "preheader") return String(variables[key as EmailTemplateVariable] || "")
    if (!EMAIL_TEMPLATE_VARIABLES.includes(key as EmailTemplateVariable)) return match
    const value = variables[key as EmailTemplateVariable]
    return value === undefined || value === null ? "" : String(value)
  })
}

function interpolateHtml(source: string, variables: EmailTemplateVariables) {
  return String(source || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    if (key === "preheader") return escapeHtml(variables[key as EmailTemplateVariable] || "")
    if (!EMAIL_TEMPLATE_VARIABLES.includes(key as EmailTemplateVariable)) return match
    const value = variables[key as EmailTemplateVariable]
    return value === undefined || value === null ? "" : escapeHtml(value)
  })
}

export async function defaultTemplateVariables(overrides: EmailTemplateVariables = {}) {
  const brand = await getPublicSiteSettings().catch(() => null)
  const brandName = brand?.brandName || SAMPLE_TEMPLATE_VARIABLES.brandName
  const appUrl = (brand?.siteUrl || SAMPLE_TEMPLATE_VARIABLES.appUrl || "").replace(/\/$/, "")
  const clientAreaUrl = brand?.clientAreaUrl || `${appUrl}/client-area`
  const supportEmail = brand?.supportEmail || SAMPLE_TEMPLATE_VARIABLES.supportEmail
  return {
    ...SAMPLE_TEMPLATE_VARIABLES,
    brandName,
    appUrl,
    websiteUrl: appUrl,
    legalCompanyName: brand?.legalCompanyName || brandName,
    clientAreaUrl,
    supportEmail,
    billingEmail: brand?.billingEmail || supportEmail,
    abuseEmail: brand?.abuseEmail || supportEmail,
    supportPhone: brand?.supportPhone || brand?.companyPhone || "",
    whatsappNumber: brand?.whatsappNumber || "",
    companyAddress: brand?.companyAddress || "",
    supportUrl: brand?.supportEmail ? `mailto:${supportEmail}` : `${appUrl}/support`,
    ticketUrl: `${clientAreaUrl}/support`,
    ...overrides,
  }
}

export function renderTemplateSource(template: { subject: string; preheader?: string | null; htmlBody: string; textBody: string }, variables: EmailTemplateVariables) {
  const merged = { ...variables, preheader: template.preheader || "" } as EmailTemplateVariables
  return {
    subject: interpolate(template.subject, variables),
    preheader: interpolate(template.preheader || "", variables),
    html: interpolateHtml(template.htmlBody, merged),
    text: interpolate(template.textBody, variables),
  }
}

function defaultForKey(key: string) {
  if (key === "support_ticket_reply") {
    return DEFAULT_EMAIL_TEMPLATES.find((item) => item.key === "support_reply")
  }
  return DEFAULT_EMAIL_TEMPLATES.find((item) => item.key === key)
}

export async function ensureDefaultEmailTemplates(updatedBy = "system") {
  await Promise.all(DEFAULT_EMAIL_TEMPLATES.map((item) => prisma.emailTemplate.upsert({
    where: { key: item.key },
    update: {
      group: item.group,
      category: item.category,
      name: item.name,
      subject: item.subject,
      preheader: item.preheader,
      htmlBody: item.htmlBody,
      textBody: item.textBody,
      updatedBy,
    },
    create: { ...item, updatedBy },
  })))

  await prisma.emailTemplate.updateMany({
    where: { key: "support_ticket_reply" },
    data: { enabled: false, category: "support", updatedBy },
  }).catch(() => null)
}

export async function listEmailTemplates() {
  await ensureDefaultEmailTemplates()
  return prisma.emailTemplate.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] })
}

export async function getEmailTemplate(key: string) {
  await ensureDefaultEmailTemplates()
  if (key === "support_ticket_reply") {
    return prisma.emailTemplate.findUnique({ where: { key: "support_reply" } })
  }
  return prisma.emailTemplate.findUnique({ where: { key } })
}

export async function resetEmailTemplate(key: string, updatedBy: string) {
  const defaults = defaultForKey(key)
  if (!defaults) return null
  return prisma.emailTemplate.upsert({
    where: { key: defaults.key },
    update: { ...defaults, enabled: true, updatedBy },
    create: { ...defaults, updatedBy },
  })
}
