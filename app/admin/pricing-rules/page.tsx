import Link from "next/link"
import { prisma } from "@/lib/db"
import { getBillingPricingSettings, getCustomConfigurationSettings } from "@/lib/settings"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

function money(value: unknown) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`
}

function jsonList(value: unknown) {
  return Array.isArray(value) ? value.map(String).join(", ") : "-"
}

export default async function AdminPricingRulesPage() {
  const [products, offers, coupons, billingPricing, customPricing] = await Promise.all([
    prisma.product.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        visibility: true,
        price1m: true,
        price3m: true,
        price6m: true,
        price12m: true,
        billingTerms: true,
      },
      take: 50,
    }),
    prisma.offer.findMany({
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      select: { id: true, name: true, active: true, offerMonthlyPrice: true, defaultBillingTerm: true },
      take: 20,
    }),
    prisma.coupon.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, code: true, active: true, discountType: true, discountValue: true },
      take: 20,
    }),
    getBillingPricingSettings().catch(() => null),
    getCustomConfigurationSettings().catch(() => null),
  ])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Pricing Rules</h1>
          <p className="mt-1 text-sm text-muted-foreground">Database-backed product prices, billing settings, offers, and coupons.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/admin/products">Products</Link></Button>
          <Button asChild variant="outline"><Link href="/admin/offers">Offers</Link></Button>
          <Button asChild variant="outline"><Link href="/admin/coupons">Coupons</Link></Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass border-border/40">
          <CardHeader><CardTitle className="text-base">Billing Settings</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>GST: {String((billingPricing as any)?.gstEnabled ?? true)}</div>
            <div>GST rate: {Number((billingPricing as any)?.gstRate ?? 18)}%</div>
            <div>Minimum wallet top-up: {money((billingPricing as any)?.minimumWalletTopupAmount)}</div>
          </CardContent>
        </Card>
        <Card className="glass border-border/40">
          <CardHeader><CardTitle className="text-base">Custom Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>Enabled: {String((customPricing as any)?.enableCustomConfiguration ?? false)}</div>
            <div>CPU monthly: {money((customPricing as any)?.cpuPricePerCoreMonthly)}</div>
            <div>RAM monthly: {money((customPricing as any)?.ramPricePerGbMonthly)}</div>
          </CardContent>
        </Card>
        <Card className="glass border-border/40">
          <CardHeader><CardTitle className="text-base">Active Discounts</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>{offers.filter((offer) => offer.active).length} active offers</div>
            <div>{coupons.filter((coupon) => coupon.active).length} active coupons</div>
            <div>{products.filter((product) => product.visibility === "public" && product.status === "active").length} public active products</div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Product Pricing</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-border/30">
            <table className="w-full text-sm">
              <thead className="border-b border-border/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-3">Product</th>
                  <th className="px-3 py-3">State</th>
                  <th className="px-3 py-3">1m</th>
                  <th className="px-3 py-3">3m</th>
                  <th className="px-3 py-3">6m</th>
                  <th className="px-3 py-3">12m</th>
                  <th className="px-3 py-3">Terms</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id} className="border-b border-border/20">
                    <td className="px-3 py-3">
                      <Link href={`/admin/products/${product.id}`} className="font-medium hover:underline">{product.name}</Link>
                      <div className="text-xs text-muted-foreground">{product.type}</div>
                    </td>
                    <td className="px-3 py-3"><Badge variant="outline">{product.status} / {product.visibility}</Badge></td>
                    <td className="px-3 py-3">{money(product.price1m)}</td>
                    <td className="px-3 py-3">{product.price3m == null ? "-" : money(product.price3m)}</td>
                    <td className="px-3 py-3">{product.price6m == null ? "-" : money(product.price6m)}</td>
                    <td className="px-3 py-3">{product.price12m == null ? "-" : money(product.price12m)}</td>
                    <td className="px-3 py-3">{jsonList(product.billingTerms)}</td>
                  </tr>
                ))}
                {!products.length ? <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No products found.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
