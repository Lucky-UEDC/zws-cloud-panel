import Link from "next/link"
import { ArrowRight, Check, MessageCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatPrice } from "@/lib/pricing"
import { computeFixedVpsPricing } from "@/lib/fixed-vps-pricing"
import { getCloudInstanceName } from "@/lib/cloud-instance-names"
import { buildDedicatedWhatsappUrl, cleanWhatsappPhone } from "@/lib/dedicated"
import { generateProductSpecs, type ProductSpecRow } from "@/lib/product-features"

type CatalogProductCardProps = {
  product: {
    id: string
    slug: string
    name: string
    type: string
    ctaMode?: string | null
    ctaLabel?: string | null
    whatsappEnabled?: boolean
    badges?: string[]
    description: string | null
    shortDescription: string | null
    cpuCores: number
    ramGb: number
    storageGb: number
    storageType: string
    bandwidthTb: number
    isFeatured: boolean
    features: string[]
    price1m: number
    calculatedMonthlyPrice?: number | null
    productMonthlyPrice?: number | null
    fixedDiscountAmount?: number | null
    fixedDiscountPercent?: number | null
    showFixedDiscount?: boolean | null
    regional?: {
      formatted?: string
      displayCurrency?: string
      approxInrLabel?: string | null
      displayAmount?: number
    } | null
    pricing?: {
      monthly?: number
      termPrice?: number
      hourly?: number
      term?: number
      termTotal?: number
      quote?: unknown
      regionalMonthly?: {
        formatted?: string
        displayCurrency?: string
        approxInrLabel?: string | null
        displayAmount?: number
      } | null
    }
    specs?: Record<string, unknown> | ProductSpecRow[] | null
    generatedSpecs?: ProductSpecRow[] | null
    dedicatedSettings?: {
      purchaseEnabled?: boolean
      whatsappEnabled?: boolean
      bandwidthLabel?: string
      location?: string
    } | null
    supportPhone?: string | null
    pageUrl?: string | null
  }
}

export function CatalogProductCard({ product }: CatalogProductCardProps) {
  const isFixedVps = String(product.type).toLowerCase() === "fixed_vps"
  const displayName = isFixedVps ? getCloudInstanceName(product) : product.name
  const name = product.name.toLowerCase()
  const tierDescription = isFixedVps
    ? name.includes("enterprise") || product.ramGb >= 64 || product.cpuCores >= 12
      ? "High-capacity virtual cloud servers for databases, SaaS platforms, and high-traffic workloads."
      : name.includes("pro") || product.cpuCores >= 4 || product.ramGb >= 8
        ? "Production-ready compute instances for growing applications and business workloads."
        : "Fast NVMe cloud servers for websites, apps, testing, and small production workloads."
    : null
  const description = tierDescription || product.shortDescription || product.description || "Managed in the unified cloud catalog."
  const mode = String(product.ctaMode || "purchase_now")
  const isDedicated = product.type === "dedicated"
  const dedicatedPurchaseEnabled = product.dedicatedSettings?.purchaseEnabled !== false
  const dedicatedWhatsappEnabled = Boolean(product.dedicatedSettings?.whatsappEnabled ?? product.whatsappEnabled ?? isDedicated)
  const fixedPricing = isFixedVps
    ? computeFixedVpsPricing({
        cpuCores: product.cpuCores,
        ramGb: product.ramGb,
        storageGb: product.storageGb,
        storageType: product.storageType,
        bandwidthTb: product.bandwidthTb,
        specs: product.specs && !Array.isArray(product.specs) ? product.specs : null,
        productMonthlyPrice: Number(product.price1m || 0),
      })
    : null
  const calculatedMonthlyPrice = Number(product.calculatedMonthlyPrice ?? fixedPricing?.calculatedMonthlyPrice ?? 0)
  const finalMonthlyPrice = Number(product.productMonthlyPrice ?? fixedPricing?.productMonthlyPrice ?? Number(product.price1m || 0))
  const displayPrice = product.pricing?.regionalMonthly?.formatted || product.regional?.formatted || formatPrice(finalMonthlyPrice)
  const displayCurrency = product.pricing?.regionalMonthly?.displayCurrency || product.regional?.displayCurrency || "INR"
  const approxInrLabel = product.pricing?.regionalMonthly?.approxInrLabel || product.regional?.approxInrLabel || null
  const dedicatedWhatsappUrl = isDedicated && dedicatedWhatsappEnabled
    ? buildDedicatedWhatsappUrl({
        phone: product.supportPhone || "",
        productName: displayName,
        price: finalMonthlyPrice,
        pageUrl: product.pageUrl || "/dedicated",
      })
    : null
  const fixedDiscountAmount = Number(product.fixedDiscountAmount ?? fixedPricing?.fixedDiscountAmount ?? 0)
  const fixedDiscountPercent = Number(product.fixedDiscountPercent ?? fixedPricing?.fixedDiscountPercent ?? 0)
  const showFixedDiscount = Boolean(product.showFixedDiscount ?? fixedPricing?.showFixedDiscount ?? false) && fixedDiscountPercent > 0 && calculatedMonthlyPrice > finalMonthlyPrice
  const specRows = product.generatedSpecs?.length ? product.generatedSpecs : generateProductSpecs(product)

  const ctaHref =
    isDedicated
      ? `/dedicated/checkout?product=${encodeURIComponent(product.slug)}&term=1`
      : mode === "configure"
      ? `/configure?product=${encodeURIComponent(product.slug)}`
      : mode === "contact_sales"
        ? `/support?topic=sales&product=${encodeURIComponent(product.slug)}`
      : `/checkout?product=${encodeURIComponent(product.slug)}&term=1`

  const ctaLabel = isDedicated ? "Book Now" : isFixedVps ? "Deploy Now" : product.ctaLabel || (mode === "configure" ? "Configure" : "Purchase Now")

  return (
    <div className={`glass glass-hover relative flex flex-col rounded-2xl p-6 ${product.isFeatured ? "accent-glow ring-1 ring-accent/30" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">{displayName}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          {!!product.badges?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {product.badges.slice(0, 3).map((badge) => (
                <span key={badge} className="rounded-full border border-[var(--border-selected)] bg-[var(--accent-subtle)] px-2.5 py-1 text-[11px] uppercase tracking-wide text-[var(--text-selected)]">
                  {badge}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-6">
        {isFixedVps && showFixedDiscount && displayCurrency === "INR" ? (
          <div className="mb-1 text-sm text-muted-foreground line-through">{formatPrice(calculatedMonthlyPrice)}</div>
        ) : null}
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-semibold tracking-tight">{displayPrice}</span>
          <span className="text-sm text-muted-foreground">/mo</span>
        </div>
        {displayCurrency !== "INR" && approxInrLabel ? <div className="mt-1 text-xs text-muted-foreground">{approxInrLabel}</div> : null}
        {isFixedVps && showFixedDiscount && displayCurrency === "INR" ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 font-medium text-cyan-400">{fixedDiscountPercent}% OFF</span>
            {fixedDiscountAmount > 0 ? <span className="text-muted-foreground">Save {formatPrice(fixedDiscountAmount)}/mo</span> : null}
          </div>
        ) : null}
      </div>

      <div className="mt-6 rounded-xl bg-foreground/[0.05] p-5 text-sm text-muted-foreground">
        <div className="grid grid-cols-2 gap-3">
          {specRows.map((spec) => (
            <div key={`${spec.label}-${spec.value}`} className={spec.label.toLowerCase().includes("network") ? "sm:col-span-2" : undefined}>
              <span className="text-muted-foreground">{spec.label}</span><br />{spec.value}
            </div>
          ))}
        </div>
      </div>

      <ul className="mt-5 flex flex-col gap-2.5 text-sm">
        {product.features.slice(0, 6).map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span className="text-muted-foreground">{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex flex-col gap-2">
        {isDedicated && !dedicatedPurchaseEnabled ? null : isDedicated ? (
          <Button asChild className="w-full gap-1.5" variant={product.isFeatured ? "default" : "outline"}>
            <Link href={ctaHref}>
              {ctaLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        ) : (
          <Button asChild className="w-full gap-1.5" variant={product.isFeatured ? "default" : "outline"}>
            <Link href={ctaHref}>
              {ctaLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        )}

        {(isDedicated ? Boolean(dedicatedWhatsappUrl) : product.whatsappEnabled && cleanWhatsappPhone(product.supportPhone || "")) ? (
          <Button asChild variant="ghost" className="w-full gap-1.5">
            <a
              href={isDedicated ? dedicatedWhatsappUrl! : `https://wa.me/${cleanWhatsappPhone(product.supportPhone || "")}?text=${encodeURIComponent(`Hello, I need help with ${displayName}`)}`}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Talk to Sales
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  )
}
