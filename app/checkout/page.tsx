import type { Metadata } from "next"
import { getCloudInstanceName } from "@/lib/cloud-instance-names"
import { SiteShell } from "@/components/layout/site-shell"
import { CheckoutContent } from "./CheckoutContent"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"
import { headers } from "next/headers"
import { buildCheckoutBootstrap, type CheckoutSearchParams } from "@/lib/checkout-bootstrap"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<CheckoutSearchParams>
}): Promise<Metadata> {
  const p = await searchParams
  const product = p.product ?? ""
  const term = p.term ?? "1"

  const instanceName = getCloudInstanceName(product || "Cloud Instance")

  return buildPageMetadata({
    title: `Deploy ${instanceName} Cloud Instance`,
    description: "Launch a high-performance cloud instance with NVMe storage, dedicated vCPU and RAM, and predictable monthly pricing.",
    path: `/checkout?product=${product}&term=${term}`,
    robots: {
      index: false,
      follow: false,
    },
  })
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<CheckoutSearchParams>
}) {
  const [bootstrap, site] = await Promise.all([
    buildCheckoutBootstrap(await searchParams, await headers()),
    getPublicSiteSettings(),
  ])
  return (
    <SiteShell>
      <CheckoutContent bootstrap={bootstrap} brandName={site.brandName} siteUrl={site.siteUrl} currency={site.currency} />
    </SiteShell>
  )
}
