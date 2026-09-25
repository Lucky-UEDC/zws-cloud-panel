import type { Metadata } from "next"
import { ComingSoonPage } from "@/components/marketing/coming-soon-page"
import { getComingSoonRoute } from "@/lib/coming-soon-routes"
import { buildPageMetadata } from "@/lib/seo/metadata"

export const dynamic = "force-dynamic"
export const revalidate = 0

const route = getComingSoonRoute("/cloud")!

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: `${route.pageName} Coming Soon`,
    description: route.description,
    path: "/cloud",
    robots: { index: false, follow: false },
  })
}

export default function CloudPage() {
  return <ComingSoonPage route={route} />
}
