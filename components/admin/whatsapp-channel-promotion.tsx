"use client"

import { useEffect, useState } from "react"
import { Megaphone, Save, Send } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { readJsonResponse } from "@/lib/client/safe-json"

export function WhatsAppChannelPromotion() {
  const [body, setBody] = useState("")
  const [saving, setSaving] = useState(false)
  const [broadcasting, setBroadcasting] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/admin/whatsapp/settings/channel-promotion", { cache: "no-store" })
      .then((r) => readJsonResponse<{ ok: boolean; body: string }>(r))
      .then((data) => { if (data?.body) setBody(data.body) })
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    try {
      const resp = await fetch("/api/admin/whatsapp/settings/channel-promotion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      })
      const data = await readJsonResponse<{ ok: boolean }>(resp)
      if (data?.ok) toast.success("Channel promotion template saved")
      else toast.error("Failed to save template")
    } catch {
      toast.error("Failed to save template")
    } finally {
      setSaving(false)
    }
  }

  async function broadcast() {
    if (!window.confirm("Send channel promotion to all opted-in WhatsApp customers?")) return
    setBroadcasting(true)
    try {
      const resp = await fetch("/api/admin/whatsapp/settings/channel-promotion", { method: "POST" })
      const data = await readJsonResponse<{ ok: boolean; campaignId?: string }>(resp)
      if (data?.ok) toast.success(`Broadcast campaign created (${data.campaignId?.slice(0, 8)})`)
      else toast.error("Failed to create broadcast")
    } catch {
      toast.error("Failed to create broadcast")
    } finally {
      setBroadcasting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-accent" />
          <CardTitle className="text-base">Channel Promotion</CardTitle>
        </div>
        <CardDescription>
          Edit the message sent to customers promoting your WhatsApp Channel. Save first, then broadcast.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          rows={10}
          value={loading ? "Loading…" : body}
          onChange={(e) => setBody(e.target.value)}
          disabled={loading || saving}
          className="font-mono text-sm"
          placeholder="Enter promotion message…"
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={save} disabled={saving || loading} className="gap-2">
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save Template"}
          </Button>
          <Button size="sm" variant="secondary" onClick={broadcast} disabled={broadcasting || loading} className="gap-2">
            <Send className="h-4 w-4" />
            {broadcasting ? "Sending…" : "Send to All Customers"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
