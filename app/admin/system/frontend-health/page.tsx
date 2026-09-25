import { FrontendHealthPanel } from "@/components/admin/frontend-health-panel"
import { buildPageMetadata } from "@/lib/seo/metadata"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata() {
  return buildPageMetadata({
    title: "Frontend Health",
    description: "Admin frontend rendering, assets, cache, and hydration diagnostics.",
    path: "/admin/system/frontend-health",
    robots: "noindex, nofollow",
  })
}

export default function AdminFrontendHealthPage() {
  return <FrontendHealthPanel />
}
