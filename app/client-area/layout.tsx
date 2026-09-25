import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getClientFromCookiesCached } from "@/lib/server-auth"
import { PanelShell } from "@/components/panel/panel-shell"
import { ClientHeader } from "@/components/client/client-header"
import { ClientSidebar } from "@/components/client/client-sidebar"
import { ClientAuthProvider } from "@/components/auth/client-auth-provider"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"
import { getPlatformConfig } from "@/lib/platform-config"

export const metadata: Metadata = {
  robots: "noindex, nofollow",
}

export default async function ClientAreaLayout({ children }: { children: React.ReactNode }) {
  const user = await getClientFromCookiesCached()

  if (!user?.email) {
    redirect("/login")
  }

  const [site, platformConfig] = await Promise.all([
    getPublicSiteSettings(),
    getPlatformConfig(),
  ])

  return (
    <ClientAuthProvider>
      <PanelShell
        header={
          <ClientHeader
            user={{ email: String(user.email), name: String(user.name || "Client") }}
            brandName={platformConfig.name || site.brandName}
          />
        }
        sidebar={<ClientSidebar />}
      >
        {children}
      </PanelShell>
    </ClientAuthProvider>
  )
}
