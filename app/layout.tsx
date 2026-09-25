import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { PanelBackground } from "@/components/effects/panel-background"
import { AnalyticsProvider } from "@/components/analytics/analytics-provider"
import { RuntimeGoogleAnalytics } from "@/components/runtime/google-analytics"
import { ChunkRecoveryListener } from "@/components/frontend/chunk-recovery-listener"
import { FrontendDiagnosticsCollector } from "@/components/frontend/frontend-diagnostics-collector"
import { getSetting, type AppearanceSettings, type PlatformSettings } from "@/lib/settings"
import { buildRootMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"
import { getPlatformConfig } from "@/lib/platform-config"
import { getRuntimeConfig } from "@/lib/runtime-config"
import { fallbackPlatformConfig, fallbackPublicSiteSettings } from "@/lib/runtime-fallbacks"
import "./globals.css"

export const dynamic = "force-dynamic"
export const revalidate = 0

// Self-hosted brand fonts (woff2 served from /_next/static/media — no
// render-blocking external request, no system-font fallback).
const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

function hexToRgbTriplet(value: string, fallback: string) {
  const hex = /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback
  const number = Number.parseInt(hex.slice(1), 16)
  return `${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}`
}

function relativeLuminance(hex: string) {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#05070B"
  const toLinear = (channel: number) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const r = toLinear(Number.parseInt(value.slice(1, 3), 16))
  const g = toLinear(Number.parseInt(value.slice(3, 5), 16))
  const b = toLinear(Number.parseInt(value.slice(5, 7), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function themeCss(appearance: AppearanceSettings | null) {
  const primary = appearance?.primaryColor || "#00D4FF"
  const secondary = appearance?.secondaryColor || "#0C111A"
  const accent = appearance?.accentColor || "#00D4FF"
  const success = appearance?.successColor || "#22C55E"
  const danger = appearance?.dangerColor || "#EF4444"
  const warning = appearance?.warningColor || "#F59E0B"
  const primaryForeground = relativeLuminance(primary) > 0.4 ? "#0A0F16" : "#F8FAFC"
  const accentRgb = hexToRgbTriplet(accent, "#00D4FF")
  const dangerRgb = hexToRgbTriplet(danger, "#EF4444")
  return `:root,.dark{--primary:${primary};--primary-foreground:${primaryForeground};--primary-hover:color-mix(in srgb,${primary} 86%,white);--secondary:${secondary};--accent:${accent};--success:${success};--danger:${danger};--warning:${warning};--accent-primary:${accent};--accent-hover:${accent};--accent-soft:rgba(${accentRgb},0.18);--accent-hover-soft:rgba(${accentRgb},0.22);--accent-subtle:rgba(${accentRgb},0.10);--border-focus:rgba(${accentRgb},0.45);--border-selected:rgba(${accentRgb},0.28);--destructive:${danger};--ring:${accent};--sidebar-primary:${accent};--sidebar-accent:rgba(${accentRgb},0.18);--danger-soft:rgba(${dangerRgb},0.12);}`
}

export async function generateMetadata(): Promise<Metadata> {
  return buildRootMetadata()
}

export const viewport: Viewport = {
  themeColor: "#05070B",
  width: "device-width",
  initialScale: 1,
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const [site, platformConfig, platform, system, appearance] = await Promise.all([
    getPublicSiteSettings().catch(fallbackPublicSiteSettings),
    getPlatformConfig().catch(fallbackPlatformConfig),
    getSetting<PlatformSettings>("platform_settings").catch(() => null),
    getRuntimeConfig().catch(() => null),
    getSetting<AppearanceSettings>("appearance_settings").catch(() => null),
  ])
  const organizationLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: platformConfig.brand,
    legalName: site.legalCompanyName,
    url: site.siteUrl,
    logo: platformConfig.logo || site.logoUrl || `${site.siteUrl.replace(/\/$/, "")}/logo.png`,
    contactPoint: [{
      "@type": "ContactPoint",
      contactType: "customer support",
      email: site.supportEmail,
      telephone: site.companyPhone,
    }],
  }
  return (
    <html lang="en" className={`dark w-full max-w-[100vw] overflow-x-hidden bg-background ${geist.variable} ${geistMono.variable}`}>
      <head>
        <style id="zws-theme-colors" dangerouslySetInnerHTML={{ __html: themeCss(appearance) }} />
        <meta name="application-name" content={platformConfig.name} />
        <meta name="apple-mobile-web-app-title" content={platformConfig.name} />
        {platformConfig.favicon ? <link rel="icon" href={platformConfig.favicon} /> : null}
      </head>
      <body className="min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-background font-sans text-foreground antialiased">
        <AnalyticsProvider>
          {system ? <RuntimeGoogleAnalytics initialConfig={system} allowAdmin={Boolean(platform?.googleAnalyticsInAdmin)} /> : null}
          {/* Full-screen interactive dot field (fixed, pointer-events-none) */}
          <PanelBackground scope="global" className="global-panel-background decorative-layer" />
          {/* App content renders above the background */}
          <div className="interactive-layer min-w-0 max-w-full overflow-x-hidden">{children}</div>
          <ChunkRecoveryListener />
          <FrontendDiagnosticsCollector />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd) }} />
          <Toaster />
        </AnalyticsProvider>
      </body>
    </html>
  )
}