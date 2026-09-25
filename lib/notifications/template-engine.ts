import { getBrandName, getSiteUrl } from "@/lib/settings/site-settings"

export type RuntimeNotificationType =
  | "login_success"
  | "login_failed"
  | "mfa_otp"
  | "phone_change"
  | "password_reset"
  | "order_placed"
  | "invoice_paid"
  | "provisioning_complete"

export type RuntimeNotificationVariables = Record<string, unknown>

function sanitize(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[{}<>]/g, "")
    .trim()
    .slice(0, 2000)
}

function domainFromUrl(value: string) {
  try {
    return new URL(value).hostname
  } catch {
    return String(process.env.SITE_DOMAIN || process.env.DOMAIN || "").trim()
  }
}

export async function runtimeBrandVariables() {
  const appUrl = await getSiteUrl().catch(() => process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "")
  const siteName = await getBrandName().catch(() => process.env.SITE_NAME || process.env.APP_NAME || process.env.NEXT_PUBLIC_APP_NAME || "Cloud")
  const siteDomain = String(process.env.SITE_DOMAIN || domainFromUrl(appUrl)).trim()
  return {
    SITE_NAME: sanitize(siteName),
    SITE_DOMAIN: sanitize(siteDomain),
    APP_URL: sanitize(appUrl),
    company_name: sanitize(siteName),
    brandName: sanitize(siteName),
    website_url: sanitize(appUrl),
    dashboard_url: sanitize(appUrl ? `${appUrl.replace(/\/$/, "")}/client-area` : ""),
  }
}

export async function buildNotificationVariables(input: RuntimeNotificationVariables = {}) {
  const brand = await runtimeBrandVariables()
  const variables: Record<string, string> = { ...brand }
  for (const [key, value] of Object.entries(input)) {
    variables[key] = sanitize(value)
  }
  variables.USER_NAME = sanitize(input.USER_NAME ?? input.userName ?? input.first_name ?? input.name ?? "there")
  variables.IP = sanitize(input.IP ?? input.ip ?? input.loginIp ?? "Unknown")
  variables.LOCATION = sanitize(input.LOCATION ?? input.location ?? [input.city, input.country].filter(Boolean).join(", ") ?? "Unknown")
  variables.DEVICE = sanitize(input.DEVICE ?? input.device ?? [input.browser, input.os].filter(Boolean).join(" on ") ?? "Unknown")
  variables.TIME = sanitize(input.TIME ?? input.time ?? input.login_time ?? new Date().toISOString())
  return variables
}

export function renderRuntimeTemplate(template: string, variables: Record<string, unknown>) {
  return String(template || "").replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) => sanitize(variables[key] ?? ""))
}
