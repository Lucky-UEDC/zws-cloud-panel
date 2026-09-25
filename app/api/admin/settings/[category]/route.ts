import { NextRequest, NextResponse } from "next/server"
import { extractClientIp } from "@/lib/request-context"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { createAuditLog } from "@/lib/audit-log"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManageSettings } from "@/lib/admin-rbac"
import { getCategoryFromParam, getSetting, maskAdminSecrets, upsertSetting } from "@/lib/settings"
import { createPanelLog } from "@/lib/panel-log"
import { revalidatePaymentGateways } from "@/lib/payments/runtime-payment-config"
import { getRuntimeConfig, revalidateRuntimeConfig } from "@/lib/runtime-config"

const BRANDING_REVALIDATE_PATHS = [
  "/",
  "/about",
  "/pricing",
  "/contact",
  "/features",
  "/infrastructure",
  "/dedicated",
  "/legal/terms",
  "/legal/privacy",
  "/legal/refund",
  "/legal/sla",
  "/legal/aup",
  "/legal/kyc",
  "/legal/cookies",
  "/legal/disclaimer",
  "/robots.txt",
  "/sitemap.xml",
]

function revalidateBrandingSurfaces() {
  for (const path of BRANDING_REVALIDATE_PATHS) {
    revalidatePath(path)
  }
  revalidatePath("/invoice/[invoiceNumber]", "page")
  revalidatePath("/client-area/billing/invoices/[id]", "page")
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ category: string }> },
) {
  try {
    const admin = await getAdminFromCookies()
    if (!admin?.email || !canManageSettings(admin.role)) {
      if ((await params).category === "smtp_settings") {
        console.warn("admin_auth_failed_for_smtp_settings", { path: request.nextUrl.pathname })
      }
      return NextResponse.json({
        ok: false,
        success: false,
        code: "ADMIN_UNAUTHORIZED",
        error: "Your admin session expired. Please sign in again.",
      }, { status: 401 })
    }

    const { category: rawCategory } = await params
    const category = getCategoryFromParam(rawCategory)
    if (!category) {
      return NextResponse.json({ success: false, error: "Invalid category" }, { status: 400 })
    }
    if (category === "smtp_settings") {
      return NextResponse.json({
        success: false,
        code: "EMAIL_SETTINGS_MOVED",
        error: "SMTP settings are managed under Admin -> Email -> SMTP Settings.",
      }, { status: 410 })
    }

    const body = await request.json().catch(() => ({}))
    const beforeValue = await getSetting<any>(category).catch(() => null)
    const before = { value: beforeValue }
    const saved = await upsertSetting(category, body, String(admin.email))

    const adminRow = await prisma.adminProfile.findUnique({
      where: { email: String(admin.email).toLowerCase() },
      select: { id: true },
    })
    if (adminRow?.id) {
      await createAuditLog({
        adminId: adminRow.id,
        action: "SETTING_UPDATED",
        oldValue: before?.value || null,
        newValue: { category, value: saved.value },
        ipAddress: extractClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }).catch(() => null)
    }
    const actionByCategory: Record<string, string> = {
      general_settings: "branding_updated",
      appearance_settings: "branding_updated",
      platform_settings: "platform_settings_updated",
      payment_settings: "payment_settings_updated",
    }
    await createPanelLog({
      category: "Admin Action",
      message: actionByCategory[category] || "settings_updated",
      actorType: "admin",
      actorEmail: admin.email,
      metadata: { category },
    }).catch(() => null)

    if (category === "custom_configuration_settings") {
      const wasEnabled = Boolean(beforeValue?.enableCustomConfiguration)
      const isEnabled = Boolean((saved.value as any)?.enableCustomConfiguration)
      if (wasEnabled !== isEnabled) {
        await createPanelLog({
          category: "Admin Action",
          message: isEnabled ? "custom_config_enabled" : "custom_config_disabled",
          actorType: "admin",
          actorEmail: admin.email,
          metadata: { category },
        }).catch(() => null)
      }
      await createPanelLog({
        category: "Admin Action",
        message: "custom_pricing_updated",
        actorType: "admin",
        actorEmail: admin.email,
        metadata: { category },
      }).catch(() => null)
    }

    if (category === "general_settings" || category === "platform_settings" || category === "appearance_settings") {
      revalidateBrandingSurfaces()
      revalidateRuntimeConfig()
    }

    if (category === "payment_settings") {
      revalidatePaymentGateways()
    }

    const value = category === "payment_settings"
      ? maskAdminSecrets(category, saved.value as any)
      : saved.value
    return NextResponse.json({ success: true, key: saved.key, value, runtimeConfig: await getRuntimeConfig().catch(() => null) })
  } catch (error: any) {
    console.error("[Admin][Settings] save failed", {
      message: error?.message,
      code: error?.code,
    })
    const rawMessage = error?.message || ""
    const isValidationError = error?.name === "ZodError" || /required|invalid|maximum|minimum|cannot be used|cannot be enabled/i.test(rawMessage)
    const message = isValidationError ? rawMessage || "Invalid settings payload" : "Internal server error"
    return NextResponse.json({ success: false, error: message }, { status: isValidationError ? 400 : 500 })
  }
}
