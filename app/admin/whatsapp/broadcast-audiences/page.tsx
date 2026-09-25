"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Inbox, Library, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { readJsonResponse } from "@/lib/client/safe-json"
import { WhatsAppNav } from "@/components/admin/whatsapp-nav"

export default function WhatsAppBroadcastAudiencesPage() {
  const [audiences, setAudiences] = useState<any[]>([])
  const [draft, setDraft] = useState({ name: "", slug: "", description: "" })
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  async function load() {
    const response = await fetch("/api/admin/whatsapp/broadcast-audiences", { cache: "no-store" })
    const data = await readJsonResponse<any>(response)
    if (response.ok) setAudiences(data.audiences || [])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function createAudience() {
    setCreating(true)
    const response = await fetch("/api/admin/whatsapp/broadcast-audiences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, filter: {} }),
    })
    const data = await readJsonResponse<any>(response)
    setCreating(false)
    if (!response.ok) return toast.error(data.error || "Unable to create audience")
    toast.success("Audience created")
    setDraft({ name: "", slug: "", description: "" })
    await load()
  }

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">Broadcast Audiences</h1>
        <p className="text-sm text-muted-foreground">Reusable consent-aware recipient segments for campaigns and lifecycle messages.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Library className="h-4 w-4 text-accent" />Create Audience</CardTitle></CardHeader>
        <CardContent className="grid min-w-0 gap-4 md:grid-cols-2">
          <Field label="Name"><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Active customers" /></Field>
          <Field label="Slug"><Input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} placeholder="active_customers" /></Field>
          <div className="min-w-0 space-y-2 md:col-span-2">
            <Label>Description</Label>
            <Textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Customers eligible for product updates and renewal reminders." />
          </div>
          <div className="md:col-span-2"><Button onClick={createAudience} disabled={creating || !draft.name} className="gap-2"><Plus className="h-4 w-4" />{creating ? "Creating..." : "Create Audience"}</Button></div>
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        {audiences.map((audience) => (
          <Card key={audience.id}>
            <CardHeader><CardTitle className="truncate text-base">{audience.name}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2"><Badge variant="outline">{audience.slug || "audience"}</Badge><Badge>{audience.status || "active"}</Badge></div>
              <p className="text-muted-foreground">{audience.description || "No description"}</p>
              <p className="text-xs text-muted-foreground">Created {formatDate(audience.createdAt)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {!loading && !audiences.length ? <AudienceEmptyState /> : null}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0 space-y-2"><Label>{label}</Label>{children}</div>
}

function AudienceEmptyState() {
  return (
    <Empty className="glass border border-dashed border-border/50 bg-background/40">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Inbox className="h-6 w-6" /></EmptyMedia>
        <EmptyTitle>No broadcast audiences</EmptyTitle>
        <EmptyDescription>Build reusable consent-aware recipient segments for campaigns and lifecycle messages.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" onClick={() => document.querySelector<HTMLInputElement>("input")?.focus()} className="gap-2"><Plus className="h-4 w-4" />Create Audience</Button>
      </EmptyContent>
    </Empty>
  )
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString()
}
