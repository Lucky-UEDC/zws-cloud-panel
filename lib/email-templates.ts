import { getBrandSettings } from "@/lib/settings"

export type BrandedEmailInput = {
  title: string
  preview?: string
  greeting?: string
  body: string
  ctaLabel?: string
  ctaUrl?: string
  footer?: string
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function paragraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((line) => `<p style="margin:0 0 16px;color:#d6dee8;line-height:1.6">${escapeHtml(line).replace(/\n/g, "<br>")}</p>`)
    .join("")
}

export async function brandedEmail(input: BrandedEmailInput) {
  const brand = await getBrandSettings()
  const company = brand.appName
  const support = brand.supportEmail
  const domain = brand.siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
  const cta = input.ctaLabel && input.ctaUrl
    ? `<p style="margin:28px 0"><a href="${escapeHtml(input.ctaUrl)}" style="background:#14b8a6;color:#041111;text-decoration:none;font-weight:700;border-radius:6px;padding:12px 18px;display:inline-block">${escapeHtml(input.ctaLabel)}</a></p>`
    : ""

  const html = `<!doctype html>
<html>
  <head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title></head>
  <body style="margin:0;background:#061014;font-family:Arial,Helvetica,sans-serif;color:#eef6f7">
    <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preview || input.title)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#061014;padding:28px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#0b151b;border:1px solid #1d333b;border-radius:10px;overflow:hidden">
          <tr><td style="padding:24px 28px;border-bottom:1px solid #1d333b;background:#081217">
            <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:0">${escapeHtml(company)}</div>
            <div style="font-size:12px;color:#81a5ad;margin-top:4px">${escapeHtml(domain)}</div>
          </td></tr>
          <tr><td style="padding:30px 28px">
            <h1 style="margin:0 0 18px;font-size:24px;line-height:1.25;color:#ffffff">${escapeHtml(input.title)}</h1>
            ${input.greeting ? `<p style="margin:0 0 16px;color:#d6dee8">Hi ${escapeHtml(input.greeting)},</p>` : ""}
            ${paragraphs(input.body)}
            ${cta}
            ${input.footer ? `<p style="margin:22px 0 0;color:#89a6ad;font-size:13px;line-height:1.5">${escapeHtml(input.footer)}</p>` : ""}
          </td></tr>
          <tr><td style="padding:18px 28px;border-top:1px solid #1d333b;color:#89a6ad;font-size:12px">
            Need help? Contact ${escapeHtml(support)}.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`

  const text = [
    `${company} - ${input.title}`,
    input.greeting ? `Hi ${input.greeting},` : "",
    input.body,
    input.ctaLabel && input.ctaUrl ? `${input.ctaLabel}: ${input.ctaUrl}` : "",
    input.footer || "",
    `Need help? Contact ${support}.`,
  ].filter(Boolean).join("\n\n")

  return { html, text, subject: input.title }
}

export async function paymentEmail(status: "success" | "failure", args: { name?: string | null; amount: number; reference: string; url?: string }) {
  return brandedEmail({
    title: status === "success" ? "Payment received" : "Payment failed",
    greeting: args.name || "there",
    body: status === "success"
      ? `We received your payment of INR ${args.amount.toLocaleString("en-IN")} for ${args.reference}.\n\nYour account and service status have been updated.`
      : `Your payment for ${args.reference} could not be completed.\n\nPlease retry the payment from your billing area or contact support if the amount was debited.`,
    ctaLabel: args.url ? "View billing" : undefined,
    ctaUrl: args.url,
  })
}

export async function renewalEmail(args: { name?: string | null; vpsName: string; amount: number; dueDate: Date; days: 3 | 2 | 1 | 0; url?: string }) {
  return brandedEmail({
    title: args.days === 0 ? "VPS renewal is due today" : `VPS renewal due in ${args.days} days`,
    greeting: args.name || "there",
    body: `Your VPS ${args.vpsName} renews on ${args.dueDate.toLocaleDateString("en-IN")}.\n\nAmount due: INR ${args.amount.toLocaleString("en-IN")}. Please complete payment to avoid suspension.`,
    ctaLabel: args.url ? "Pay renewal" : undefined,
    ctaUrl: args.url,
  })
}
