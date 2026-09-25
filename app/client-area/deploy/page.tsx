import type { Metadata } from "next"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { normalizeProductFamily } from "@/lib/catalog-product"
import { getCloudInstanceName } from "@/lib/cloud-instance-names"
import { getCustomConfigurationSettings } from "@/lib/settings"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicProducts } from "@/lib/public-products"
import { formatBandwidthQuota } from "@/lib/bandwidth-format"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Deploy Cloud VPS Instance",
    description: "Launch a production-ready virtual cloud server with NVMe storage, dedicated resources, and included bandwidth.",
    path: "/client-area/deploy",
    robots: "noindex, nofollow",
  })
}

type DeployProduct = {
  id: string
  slug: string
  name: string
  shortDescription: string | null
  type: "fixed_vps" | "configurable"
  cpuCores: number
  ramGb: number
  storageGb: number
  storageType: string
  bandwidthTb: number
  bandwidthLabel?: string
  price1m: number
  isFeatured: boolean
}

const TIER_COPY = {
  starter: "Fast NVMe cloud servers for websites, apps, testing, and small production workloads.",
  pro: "Production-ready Cloud VPS instances for growing applications and business workloads.",
  enterprise: "High-capacity virtual cloud servers for databases, SaaS platforms, and high-traffic workloads.",
  custom: "Build a virtual cloud server with the exact vCPU, RAM, NVMe storage, and bandwidth profile your workload needs.",
} as const

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value)
}

function productHref(product: DeployProduct) {
  return product.type === "configurable" ? "/configure" : `/checkout?product=${encodeURIComponent(product.slug)}&term=1`
}

function productTier(product: DeployProduct): keyof typeof TIER_COPY {
  const name = product.name.toLowerCase()
  if (product.type === "configurable") return "custom"
  if (name.includes("enterprise") || product.ramGb >= 64 || product.cpuCores >= 12) return "enterprise"
  if (name.includes("pro") || product.cpuCores >= 4 || product.ramGb >= 8) return "pro"
  return "starter"
}

function PlanCard({ product }: { product: DeployProduct }) {
  const tier = productTier(product)
  const displayName = product.type === "fixed_vps" ? getCloudInstanceName(product) : product.name
  return (
    <Card className="flex h-full flex-col border-border/40 bg-background/80">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-lg leading-tight">{displayName}</CardTitle>
            <CardDescription className="mt-2 leading-relaxed">{TIER_COPY[tier]}</CardDescription>
          </div>
          {product.isFeatured ? <span className="shrink-0 rounded-full bg-foreground px-2 py-1 text-xs text-background">Featured</span> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col space-y-5">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-foreground/[0.04] p-3"><div className="text-muted-foreground">vCPU</div><div className="font-medium">{product.cpuCores} cores</div></div>
          <div className="rounded-lg bg-foreground/[0.04] p-3"><div className="text-muted-foreground">RAM</div><div className="font-medium">{product.ramGb} GB</div></div>
          <div className="rounded-lg bg-foreground/[0.04] p-3"><div className="text-muted-foreground">NVMe Storage</div><div className="font-medium">{product.storageGb} GB {product.storageType.toUpperCase()}</div></div>
          <div className="rounded-lg bg-foreground/[0.04] p-3"><div className="text-muted-foreground">Included Bandwidth</div><div className="font-medium">{product.bandwidthLabel || formatBandwidthQuota(product.bandwidthTb)}</div></div>
        </div>
        <div className="mt-auto flex items-end justify-between gap-3">
          <div>
            <div className="text-2xl font-semibold">{formatPrice(product.price1m)}</div>
            <div className="text-xs text-muted-foreground">/month</div>
          </div>
          <Button asChild>
            <Link href={productHref(product)}>{product.type === "configurable" ? "Build Custom Instance" : "Deploy Now"}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ProductSection({ title, products }: { title: string; products: DeployProduct[] }) {
  if (!products.length) return null
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="grid auto-rows-fr gap-4 md:grid-cols-2 xl:grid-cols-3">{products.map((product) => <PlanCard key={product.id} product={product} />)}</div>
    </section>
  )
}

export default async function ClientDeployPage() {
  const customSettings = await getCustomConfigurationSettings()
  const rows = await getPublicProducts({ categorySlug: "vps", orderBy: [{ sortOrder: "asc" }, { price1m: "asc" }] })

  const products = rows
    .map((product): DeployProduct | null => {
      const type = normalizeProductFamily(product.type)
      if (type !== "fixed_vps" && type !== "configurable") return null
      if (type === "configurable" && !customSettings.enableCustomConfiguration) return null
      return {
        id: product.id,
        slug: product.slug,
        name: product.name,
        shortDescription: product.shortDescription,
        type,
        cpuCores: product.cpuCores,
        ramGb: product.ramGb,
        storageGb: product.storageGb,
        storageType: product.storageType || "nvme",
        bandwidthTb: Number(product.bandwidthTb),
        price1m: Number(product.price1m),
        isFeatured: product.isFeatured,
      }
    })
    .filter((product): product is DeployProduct => Boolean(product))

  const fixedProducts = products.filter((product) => product.type === "fixed_vps")
  const customProducts = products.filter((product) => product.type === "configurable")
  const starterProducts = fixedProducts.filter((product) => productTier(product) === "starter")
  const proProducts = fixedProducts.filter((product) => productTier(product) === "pro")
  const enterpriseProducts = fixedProducts.filter((product) => productTier(product) === "enterprise")

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 pt-2">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-accent">Cloud Deployment</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Deploy Cloud Server</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Choose a cloud instance plan or build a custom configuration.
        </p>
      </header>

      {!products.length ? (
        <Card className="glass border-border/40">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No Cloud VPS products are currently available. Please contact support.
          </CardContent>
        </Card>
      ) : null}

      <ProductSection title="Starter Cloud Instance plans" products={starterProducts} />
      <ProductSection title="Pro Cloud Instance plans" products={proProducts} />
      <ProductSection title="Enterprise Virtual Cloud Servers" products={enterpriseProducts} />
      {customSettings.enableCustomConfiguration ? <ProductSection title="Custom Cloud Instance" products={customProducts} /> : null}

      {customSettings.enableCustomConfiguration && !customProducts.length && products.length ? (
        <Card className="border-border/40 bg-background/80">
          <CardHeader>
            <CardTitle>Custom Cloud Instance</CardTitle>
            <CardDescription>Need a different vCPU, RAM, or NVMe storage mix?</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline"><Link href="/configure">Build Custom Instance</Link></Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
