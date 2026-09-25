import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"
import { fallbackPublicSiteSettings } from "@/lib/runtime-fallbacks"

export async function SiteShell({ children }: { children: React.ReactNode }) {
  const site = await getPublicSiteSettings().catch(fallbackPublicSiteSettings)
  return (
    <div className="interactive-layer flex min-h-screen flex-col">
      <Navbar brandName={site.brandName} />
      <main className="interactive-layer flex-1">{children}</main>
      <Footer />
    </div>
  )
}
