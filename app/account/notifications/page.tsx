"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { readJsonResponse } from "@/lib/client/safe-json"
import { useRuntimeBrand } from "@/lib/client/use-runtime-brand"

type Preference = {
  category: string
  emailEnabled: boolean
  whatsappEnabled: boolean
  marketingEnabled: boolean
  transactionalEnabled: boolean
}

export default function AccountNotificationsPage() {
  const brand = useRuntimeBrand()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [whatsappOptIn, setWhatsappOptIn] = useState(true)
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [preferences, setPreferences] = useState<Preference[]>([])

  const load = useCallback(async () => {
    const response = await fetch("/api/account/notifications", { cache: "no-store" })
    const data = await readJsonResponse<any>(response)
    if (response.ok) {
      setWhatsappOptIn(Boolean(data.whatsappOptIn))
      setPhoneVerified(Boolean(data.phoneVerified))
      setPreferences(data.preferences || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function update(category: string, key: keyof Preference, value: boolean) {
    setPreferences((items) => items.map((item) => item.category === category ? { ...item, [key]: value } : item))
  }

  async function save() {
    setSaving(true)
    try {
      const response = await fetch("/api/account/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsappOptIn, preferences }),
      })
      const data = await readJsonResponse<any>(response)
      if (!response.ok) {
        toast.error(data.error || "Unable to save notification settings")
        return
      }
      toast.success("Notification settings saved")
    } catch {
      toast.error("Unable to save notification settings")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <main className="mx-auto max-w-4xl p-6 text-sm text-muted-foreground">Loading notification settings...</main>

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Notification Preferences</h1>
          <p className="text-sm text-muted-foreground">Choose how {brand.brandName} contacts you for account, service, support, and promotional updates.</p>
        </div>
        <Button asChild variant="outline"><Link href="/client-area/settings">Account settings</Link></Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">WhatsApp <Badge variant={phoneVerified ? "default" : "secondary"}>{phoneVerified ? "Verified" : "Not verified"}</Badge></CardTitle>
          <CardDescription>Transactional messages may include login alerts, invoices, provisioning, renewal, and support updates.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">WhatsApp notifications</p>
            <p className="text-sm text-muted-foreground">Turn off to stop non-critical WhatsApp messages.</p>
          </div>
          <Switch checked={whatsappOptIn} onCheckedChange={setWhatsappOptIn} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Categories</CardTitle>
          <CardDescription>Promotions can be disabled separately from service updates.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {preferences.map((preference) => (
            <div key={preference.category} className="grid gap-3 rounded-lg border border-border/50 p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
              <div>
                <p className="font-medium capitalize">{preference.category}</p>
                <p className="text-sm text-muted-foreground">Email and WhatsApp delivery controls.</p>
              </div>
              <Toggle label="Email" checked={preference.emailEnabled} onChange={(checked) => update(preference.category, "emailEnabled", checked)} />
              <Toggle label="WhatsApp" checked={preference.whatsappEnabled} onChange={(checked) => update(preference.category, "whatsappEnabled", checked)} />
              <Toggle label="Promos" checked={preference.marketingEnabled} onChange={(checked) => update(preference.category, "marketingEnabled", checked)} />
            </div>
          ))}
          <Button type="button" onClick={save} disabled={saving === true}>{saving ? "Saving..." : "Save Preferences"}</Button>
        </CardContent>
      </Card>
    </main>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex items-center justify-between gap-2 text-sm sm:justify-start">{label}<Switch checked={checked} onCheckedChange={onChange} /></label>
}
