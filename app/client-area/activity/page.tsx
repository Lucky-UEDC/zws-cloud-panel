"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useEffect, useState } from "react"
import { Activity, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"

type EventRow = {
  id: string
  timestamp: string
  severity: string
  category: string
  title: string
  message: string
  status?: string
  orderId?: string | null
  vpsInstanceId?: string | null
  metadataSummary?: string
}

function variant(severity: string) {
  if (["ERROR", "CRITICAL"].includes(String(severity).toUpperCase())) return "destructive" as const
  if (String(severity).toUpperCase() === "SUCCESS") return "default" as const
  return "secondary" as const
}

export default function ClientActivityPage() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const res = await fetch("/api/client/activity", { cache: "no-store" })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) throw new Error(data?.error || "Unable to load activity")
    setEvents(Array.isArray(data.events) ? data.events : [])
    setLoading(false)
  }

  useEffect(() => {
    void load().catch((error) => {
      setLoading(false)
      toast.error(error.message || "Unable to load activity")
    })
    const source = new EventSource("/api/client/activity/stream")
    source.addEventListener("events", (message) => {
      const rows = JSON.parse(String((message as MessageEvent).data || "[]")) as EventRow[]
      setEvents((current) => {
        const seen = new Set(current.map((event) => event.id))
        return [...rows.filter((event) => !seen.has(event.id)).reverse(), ...current].slice(0, 200)
      })
    })
    source.onerror = () => source.close()
    return () => source.close()
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Activity Timeline</h1>
          <p className="mt-1 text-sm text-muted-foreground">Deployment, billing, network, and account events for your services.</p>
        </div>
        <Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
      </div>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> Live event feed</CardTitle>
          <CardDescription>Events are persisted and update in real time.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {events.map((event) => (
            <div key={event.id} className="rounded-md border border-border/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">{event.title || event.message}</div>
                <Badge variant={variant(event.severity)}>{event.severity}</Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {new Date(event.timestamp).toLocaleString()} · {event.category}
              </div>
              {event.metadataSummary ? <div className="mt-2 text-sm text-muted-foreground">{event.metadataSummary}</div> : null}
            </div>
          ))}
          {!events.length ? <div className="py-10 text-center text-sm text-muted-foreground">{loading ? "Loading activity..." : "No activity recorded yet. New deployment, billing, and security events will appear here."}</div> : null}
        </CardContent>
      </Card>
    </div>
  )
}
