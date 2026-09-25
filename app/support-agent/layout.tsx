import { redirect } from "next/navigation"
import { PanelShell } from "@/components/panel/panel-shell"
import { AdminHeader } from "@/components/admin/admin-header"
import { SupportAgentSidebar } from "@/components/support-agent/support-agent-sidebar"
import { getAdminFromCookiesCached } from "@/lib/server-auth"
import { getPlatformConfig } from "@/lib/platform-config"

export default async function SupportAgentLayout({ children }: { children: React.ReactNode }) {
  const user = await getAdminFromCookiesCached()

  if (!user?.email || user.role !== "support_agent") {
    redirect("/login")
  }

  const platform = await getPlatformConfig()

  return (
    <PanelShell
      header={
        <AdminHeader
          user={{
            email: String(user.email),
            displayName: String(user.displayName || "Support Agent"),
            role: String(user.role || "support_agent"),
          }}
          brandName={`${platform.brand} Support`}
          homeHref="/support-agent"
        />
      }
      sidebar={<SupportAgentSidebar />}
    >
      {children}
    </PanelShell>
  )
}
