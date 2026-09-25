"use client"

import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

type Health = {
  ledger?: Record<string, any>
  whatsappQueues?: Record<string, any>
  checkedAt?: string
}

const metrics = [
  ["Queue Size", "queueSize"],
  ["Pending", "pending"],
  ["Retry", "retrying"],
  ["Delivered", "delivered"],
  ["Failed", "failed"],
  ["Duplicate Prevented", "duplicatePrevented"],
  ["Today's Sent", "todaysSent"],
  ["Today's Skipped", "todaysSkipped"],
  ["Spam Prevented", "spamPrevented"],
]

export default function NotificationHealthPage() {
  const [data, setData] = useState<Health | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const response = await fetch("/api/admin/system/notification-health", { credentials: "include", cache: "no-store" })
    const body = await response.json().catch(() => ({}))
    if (response.ok) setData(body)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const ledger = data?.ledger || {}

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Notification Health</h1>
          <p className="mt-1 text-sm text-muted-foreground">Queue, delivery, duplicate-prevention, and spam-control telemetry.</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map(([label, key]) => (
          <div key={key} className="rounded-lg border bg-card p-4">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{Number(ledger[key] || 0).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-base font-semibold">WhatsApp Queues</h2>
        <pre className="mt-3 max-h-[420px] overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(data?.whatsappQueues || {}, null, 2)}</pre>
      </div>
    </div>
  )
}
