"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { readJsonResponse } from "@/lib/client/safe-json"

export default function CouponDetailsPage() {
  const params = useParams<{ id: string }>()
  const id = String(params?.id || "")
  const [coupon, setCoupon] = useState<any>(null)

  useEffect(() => {
    if (!id) return
    fetch(`/api/admin/coupons/${id}`, { cache: "no-store" })
      .then((res) => readJsonResponse<any>(res))
      .then((data) => setCoupon(data))
      .catch((error) => toast.error(error?.message || "Unable to load coupon"))
  }, [id])

  if (!coupon) return <p className="text-sm text-muted-foreground">Loading coupon...</p>

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2"><Link href="/admin/coupons"><ArrowLeft className="mr-2 h-4 w-4" />Back to Coupons</Link></Button>
        <h1 className="text-3xl font-semibold">{coupon.code}</h1>
        <p className="text-muted-foreground">{coupon.description || "Coupon details and usage analytics."}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Times Used" value={coupon.timesUsed || 0} />
        <Stat label="Discount Given" value={`₹${Number(coupon.discountGiven ?? (coupon.revenueImpact || 0)).toLocaleString("en-IN")}`} />
        <Stat label="Remaining Uses" value={coupon.remainingUses ?? "Unlimited"} />
        <Stat label="Customers Used" value={coupon.customerUsage || 0} />
      </div>
      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Recent Usage</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2">Customer</th><th>Order</th><th>Discount</th><th>Status</th><th>Redeemed</th></tr></thead>
            <tbody>
              {(coupon.redemptions || []).map((row: any) => (
                <tr key={row.id} className="border-b border-border/20">
                  <td className="py-2">{row.customer?.name || row.customer?.email || row.customerId}</td>
                  <td>{row.order?.orderNumber || row.orderId}</td>
                  <td>₹{Number(row.discountAmount || 0).toLocaleString("en-IN")}</td>
                  <td>{row.status}</td>
                  <td>{new Date(row.redeemedAt).toLocaleString()}</td>
                </tr>
              ))}
              {!coupon.redemptions?.length ? <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No coupon usage yet.</td></tr> : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: any }) {
  return <div className="glass rounded-xl p-5"><div className="text-sm text-muted-foreground">{label}</div><div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div></div>
}
