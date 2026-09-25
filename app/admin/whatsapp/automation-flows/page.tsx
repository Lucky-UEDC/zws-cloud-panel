"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { GitBranch, Inbox, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { readJsonResponse } from "@/lib/client/safe-json"
import { WhatsAppNav } from "@/components/admin/whatsapp-nav"

export default function WhatsAppAutomationFlowsPage() {
  const [data, setData] = useState<any>({ flows: [], runs: [] })
  const [draft, setDraft] = useState({ name: "", slug: "", trigger: "phone_verified", status: "draft" })
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  async function load() {
    const response = await fetch("/api/admin/whatsapp/automation-flows", { cache: "no-store" })
    const next = await readJsonResponse<any>(response)
    if (response.ok) setData(next)
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function createFlow() {
    setCreating(true)
    const response = await fetch("/api/admin/whatsapp/automation-flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, steps: [] }),
    })
    const result = await readJsonResponse<any>(response)
    setCreating(false)
    if (!response.ok) return toast.error(result.error || "Unable to create flow")
    toast.success("Flow created")
    setDraft({ name: "", slug: "", trigger: "phone_verified", status: "draft" })
    await load()
  }

  const flows = data.flows || []

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">Automation Flows</h1>
        <p className="text-sm text-muted-foreground">Create onboarding, OTP, and lifecycle WhatsApp automations.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><GitBranch className="h-4 w-4 text-accent" />Create Flow</CardTitle></CardHeader>
        <CardContent className="grid min-w-0 gap-4 md:grid-cols-4">
          <Field label="Name"><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Verified onboarding" /></Field>
          <Field label="Slug"><Input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} placeholder="verified_onboarding" /></Field>
          <Field label="Trigger"><Input value={draft.trigger} onChange={(event) => setDraft({ ...draft, trigger: event.target.value })} /></Field>
          <Field label="Status"><Input value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} /></Field>
          <div className="md:col-span-4"><Button onClick={createFlow} disabled={creating || !draft.name || !draft.trigger} className="gap-2"><Plus className="h-4 w-4" />{creating ? "Creating..." : "Create Flow"}</Button></div>
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        {flows.map((flow: any) => (
          <Card key={flow.id}>
            <CardHeader><CardTitle className="truncate text-base">{flow.name}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2"><Badge>{flow.status || "draft"}</Badge><Badge variant="outline">{flow.trigger || "trigger"}</Badge></div>
              <p className="text-muted-foreground">Steps: {Array.isArray(flow.steps) ? flow.steps.length : 0}</p>
              <p className="text-xs text-muted-foreground">Created {formatDate(flow.createdAt)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {!loading && !flows.length ? <FlowEmptyState /> : null}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0 space-y-2"><Label>{label}</Label>{children}</div>
}

function FlowEmptyState() {
  return (
    <Empty className="glass border border-dashed border-border/50 bg-background/40">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Inbox className="h-6 w-6" /></EmptyMedia>
        <EmptyTitle>No automation flows</EmptyTitle>
        <EmptyDescription>Create onboarding, OTP and lifecycle automations.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" onClick={() => document.querySelector<HTMLInputElement>("input")?.focus()} className="gap-2"><Plus className="h-4 w-4" />Create Flow</Button>
      </EmptyContent>
    </Empty>
  )
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString()
}
