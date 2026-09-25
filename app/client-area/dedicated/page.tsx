"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Server } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { readJsonResponse } from "@/lib/client/safe-json"
import { formatPrice } from "@/lib/pricing"

type DedicatedRow = {
  id: string
  serviceNumber: string
  orderNumber: string
  productName: string
  status: string
  selectedOs: string | null
  billingTerm: number
  renewalDate: string | null
  invoice: { id: string; status: string; totalAmount: number } | null
  estimatedDeliveryAt: string | null
  primaryIp: string | null
}

function statusLabel(value: string) {
  if (value === "paid_waiting_installation") return "Awaiting installation"
  if (value === "installing") return "Installing"
  if (value === "delivered") return "Delivered"
  return value.replace(/_/g, " ")
}

export default function ClientDedicatedPage() {
  const [rows, setRows] = useState<DedicatedRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/client/dedicated", { cache: "no-store" })
      .then(async (res) => {
        const data = await readJsonResponse<any>(res)
        if (res.ok) setRows(Array.isArray(data.services) ? data.services : [])
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <Card className="glass border-border/40">
      <CardHeader>
        <CardTitle>Dedicated Servers</CardTitle>
        <CardDescription>Bare metal server orders, delivery status, credentials, and billing.</CardDescription>
      </CardHeader>
      <CardContent>
        {!loading && rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-10 text-center">
            <Server className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-lg font-medium">No dedicated servers yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Book a dedicated server to track manual delivery here.</p>
            <Button asChild className="mt-4"><Link href="/dedicated">View Dedicated Servers</Link></Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="py-3">Server</th>
                  <th>OS / Platform</th>
                  <th>Status</th>
                  <th>Invoice</th>
                  <th>Renewal</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b align-top">
                    <td className="py-3">
                      <div className="font-medium">{row.productName}</div>
                      <div className="text-xs text-muted-foreground">{row.orderNumber} - {row.primaryIp || row.serviceNumber}</div>
                    </td>
                    <td>{row.selectedOs || "-"}</td>
                    <td><Badge variant={row.status === "delivered" ? "default" : "secondary"}>{statusLabel(row.status)}</Badge></td>
                    <td>{row.invoice ? <span>{row.invoice.status} - {formatPrice(row.invoice.totalAmount)}</span> : "-"}</td>
                    <td>{row.renewalDate ? new Date(row.renewalDate).toLocaleDateString() : "-"}</td>
                    <td className="text-right"><Button asChild size="sm" variant="outline"><Link href={`/client-area/dedicated/${row.id}`}>Manage</Link></Button></td>
                  </tr>
                ))}
                {loading ? <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Loading dedicated servers...</td></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
