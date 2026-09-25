"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Inbox, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { readJsonResponse } from "@/lib/client/safe-json"
import { WhatsAppNav } from "@/components/admin/whatsapp-nav"

export default function WhatsAppCommunitiesPage() {
  const [data, setData] = useState<any>({ communities: [], groups: [], invites: [] })
  const [draft, setDraft] = useState({ name: "", category: "customer", country: "", language: "" })

  async function load() {
    const response = await fetch("/api/admin/whatsapp/communities", { cache: "no-store" })
    const next = await readJsonResponse<any>(response)
    if (response.ok) setData(next)
  }

  useEffect(() => { void load() }, [])

  async function createCommunity() {
    const response = await fetch("/api/admin/whatsapp/communities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    })
    const result = await readJsonResponse<any>(response)
    if (!response.ok) return toast.error(result.error || "Unable to create community")
    toast.success("Community created")
    setDraft({ name: "", category: "customer", country: "", language: "" })
    await load()
  }

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div>
        <h1 className="text-2xl font-semibold">WhatsApp Communities</h1>
        <p className="text-sm text-muted-foreground">Track communities, groups, invite links, approvals, member counts, and engagement without forced joins.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Create Community</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <Field label="Name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Category"><Input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></Field>
          <Field label="Country"><Input value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })} /></Field>
          <Field label="Language"><Input value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })} /></Field>
          <div className="flex items-end"><Button onClick={createCommunity} disabled={!draft.name}>Create</Button></div>
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-4 md:grid-cols-4">
        <Metric label="Communities" value={data.communities?.length || 0} />
        <Metric label="Groups" value={data.groups?.length || 0} />
        <Metric label="Active invites" value={(data.invites || []).filter((invite: any) => invite.status === "active").length} />
        <Metric label="Pending approvals" value={(data.groups || []).reduce((sum: number, group: any) => sum + Number(group.pendingApprovals || 0), 0)} />
      </div>

      {(data.communities || []).length ? (
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        {(data.communities || []).map((community: any) => (
          <Card key={community.id}>
            <CardHeader><CardTitle className="text-base">{community.name}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2"><Badge>{community.status}</Badge><Badge variant="outline">{community.category}</Badge>{community.country ? <Badge variant="outline">{community.country}</Badge> : null}</div>
              <p className="text-muted-foreground">{community.description || "No description"}</p>
              <p className="text-xs text-muted-foreground">Groups: {(data.groups || []).filter((group: any) => group.communityId === community.id).length}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      ) : (
        <EmptyState title="No communities yet" description="Create regional, customer, VIP, or onboarding communities and attach invite-only groups." cta="Create Community" />
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>
}

function Metric({ label, value }: { label: string; value: number }) {
  return <Card><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value}</p></CardContent></Card>
}

function EmptyState({ title, description, cta }: { title: string; description: string; cta: string }) {
  return (
    <Empty className="glass border border-dashed border-border/50 bg-background/40">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Inbox className="h-6 w-6" /></EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" onClick={() => document.querySelector<HTMLInputElement>("input")?.focus()} className="gap-2"><Plus className="h-4 w-4" />{cta}</Button>
      </EmptyContent>
    </Empty>
  )
}
