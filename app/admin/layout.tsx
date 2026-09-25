import { Metadata } from "next"
import { redirect } from "next/navigation"
import { AdminSidebar } from "@/components/admin/admin-sidebar"
import { AdminHeader } from "@/components/admin/admin-header"
import { PanelShell } from "@/components/panel/panel-shell"
import { getAdminFromCookiesCached } from "@/lib/server-auth"
import { getSetting, type PaymentSettings } from "@/lib/settings"
import { prisma } from "@/lib/db"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"
import { getPlatformConfig } from "@/lib/platform-config"
import { getStartupSchemaCheck } from "@/lib/startup-schema-check"
import Link from "next/link"
import { AdminRouteGuard } from "@/components/admin/admin-route-guard"

async function getRuntimeGatewayMode() {
  const rows = await (prisma as any).paymentGateway.findMany({
    where: { enabled: true },
    select: { mode: true, environment: true, active: true },
  }).catch(() => [])
  const active = rows.filter((row: any) => row.active !== false)
  if (active.some((row: any) => ["production", "live"].includes(String(row.mode || row.environment || "").toLowerCase()))) return "production"
  if (active.length) return "sandbox"
  return null
}

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Admin Dashboard",
    description: "Admin management system.",
    path: "/admin",
    robots: "noindex, nofollow",
  })
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getAdminFromCookiesCached()

  if (!user?.email) {
    redirect("/zwsloginsam")
  }

  const [site, platformConfig, payment, runtimeGatewayMode, startupSchema] = await Promise.all([
    getPublicSiteSettings().catch((error) => {
      console.error("Admin site settings failed:", error)
      return { brandName: process.env.NEXT_PUBLIC_APP_NAME || process.env.APP_NAME || "Cloud" }
    }),
    getPlatformConfig().catch((error) => {
      console.error("Admin platform config failed:", error)
      const fallbackName = process.env.NEXT_PUBLIC_APP_NAME || process.env.APP_NAME || "Cloud"
      return { name: fallbackName, brand: fallbackName, logo: "", favicon: "", footerLogo: "", invoiceLogo: "", openGraphImage: "", primaryColor: "#14b8a6" }
    }),
    getSetting<PaymentSettings>("payment_settings").catch((error) => {
      console.error("Admin payment settings failed:", error)
      return { paymentMode: "sandbox", cashfreeEnvironment: "sandbox", paymentBypassTestMode: false } as unknown as PaymentSettings
    }),
    getRuntimeGatewayMode(),
    getStartupSchemaCheck().catch((error) => {
      console.error("Admin startup schema check failed:", error)
      return { ok: true, degradedFeatures: [] }
    }),
  ])
  const gatewayMode = runtimeGatewayMode || (payment.paymentMode === "production" || payment.cashfreeEnvironment === "production" ? "production" : "sandbox")
  const showTestModeBanner = Boolean(payment.paymentBypassTestMode) || gatewayMode !== "production"

  return (
    <PanelShell
      header={
        <AdminHeader
          user={{ email: String(user.email), displayName: String(user.displayName || "Admin"), role: String(user.role || "admin") }}
          brandName={`${platformConfig.brand || site.brandName} Admin`}
        />
      }
      sidebar={<AdminSidebar role={String(user.role || "admin")} />}
    >
      {(showTestModeBanner && gatewayMode !== "production") ? (
        <div className="glass rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
          Gateway: Sandbox
        </div>
      ) : null}
      {!startupSchema.ok ? (
        <div className="glass rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
          Enterprise networking is running in safe degraded mode. Platform diagnostics detected unavailable services or schema checks: {(startupSchema.degradedFeatures || []).join(", ") || "unknown cause"}.
          {" "}
          <Link href="/admin/orders" className="underline">Open diagnostics from Orders</Link>
        </div>
      ) : null}
      <AdminRouteGuard role={String(user.role || "admin")} />
      {children}
    </PanelShell>
  )
}
