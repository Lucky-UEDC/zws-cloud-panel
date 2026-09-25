import { InteractionAuditPanel } from "@/components/admin/interaction-audit-panel"
import { buildPageMetadata } from "@/lib/seo/metadata"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata() {
  return buildPageMetadata({
    title: "Interaction Audit",
    description: "Admin interaction and overlay diagnostics.",
    path: "/admin/system/interactions",
    robots: "noindex, nofollow",
  })
}

export default function AdminSystemInteractionsPage() {
  return <InteractionAuditPanel />
}
