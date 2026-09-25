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

export default function WhatsAppGroupsPage() {
  const [data, setData] = useState<any>({ groups: [], invites: [], memberStats: [] })
  const [groupDraft, setGroupDraft] = useState({ name: "", category: "customer", country: "", language: "", service: "", inviteLink: "", approvalMode: "optional" })
  const [inviteDraft, setInviteDraft] = useState({ groupId: "", inviteLink: "", expiresAt: "", usageLimit: "" })

  async function load() {
    const response = await fetch("/api/admin/whatsapp/groups", { cache: "no-store" })
    const next = await readJsonResponse<any>(response)
    if (response.ok) setData(next)
  }

  useEffect(() => { void load() }, [])

  async function createGroup() {
    const response = await fetch("/api/admin/whatsapp/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(groupDraft),
    })
    const result = await readJsonResponse<any>(response)
    if (!response.ok) return toast.error(result.error || "Unable to create group")
    toast.success("Group created")
    setGroupDraft({ name: "", category: "customer", country: "", language: "", service: "", inviteLink: "", approvalMode: "optional" })
    await load()
  }

  async function createInvite() {
    const response = await fetch("/api/admin/whatsapp/groups/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inviteDraft),
    })
    const result = await readJsonResponse<any>(response)
    if (!response.ok) return toast.error(result.error || "Unable to create invite")
    toast.success("Invite saved")
    setInviteDraft({ groupId: "", inviteLink: "", expiresAt: "", usageLimit: "" })
    await load()
  }

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div>
        <h1 className="text-2xl font-semibold">WhatsApp Groups</h1>
        <p className="text-sm text-muted-foreground">Manage onboarding, VIP, customer, support, language, and regional groups using invite links only.</p>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Create Group</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Field label="Name"><Input value={groupDraft.name} onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })} /></Field>
            <Field label="Category"><Input value={groupDraft.category} onChange={(e) => setGroupDraft({ ...groupDraft, category: e.target.value })} /></Field>
            <Field label="Country"><Input value={groupDraft.country} onChange={(e) => setGroupDraft({ ...groupDraft, country: e.target.value })} /></Field>
            <Field label="Language"><Input value={groupDraft.language} onChange={(e) => setGroupDraft({ ...groupDraft, language: e.target.value })} /></Field>
            <Field label="Service"><Input value={groupDraft.service} onChange={(e) => setGroupDraft({ ...groupDraft, service: e.target.value })} placeholder="RDP" /></Field>
            <Field label="Default invite link"><Input value={groupDraft.inviteLink} onChange={(e) => setGroupDraft({ ...groupDraft, inviteLink: e.target.value })} /></Field>
            <div className="md:col-span-2"><Button onClick={createGroup} disabled={!groupDraft.name}>Create Group</Button></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Invite Link Manager</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Field label="Group id"><Input value={inviteDraft.groupId} onChange={(e) => setInviteDraft({ ...inviteDraft, groupId: e.target.value })} /></Field>
            <Field label="Invite link"><Input value={inviteDraft.inviteLink} onChange={(e) => setInviteDraft({ ...inviteDraft, inviteLink: e.target.value })} /></Field>
            <Field label="Expires at"><Input type="datetime-local" value={inviteDraft.expiresAt} onChange={(e) => setInviteDraft({ ...inviteDraft, expiresAt: e.target.value })} /></Field>
            <Field label="Usage limit"><Input value={inviteDraft.usageLimit} onChange={(e) => setInviteDraft({ ...inviteDraft, usageLimit: e.target.value })} /></Field>
            <div className="md:col-span-2"><Button onClick={createInvite} disabled={!inviteDraft.groupId || !inviteDraft.inviteLink}>Save Invite</Button></div>
          </CardContent>
        </Card>
      </div>

      {(data.groups || []).length ? (
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        {(data.groups || []).map((group: any) => (
          <Card key={group.id}>
            <CardHeader><CardTitle className="text-base">{group.name}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2"><Badge>{group.status}</Badge><Badge variant="outline">{group.category}</Badge><Badge variant="outline">{group.approvalMode}</Badge></div>
              <p className="text-muted-foreground">{group.description || `${group.country || "Global"} ${group.language || ""} ${group.service || ""}`}</p>
              <p className="text-xs text-muted-foreground">Members {group.memberCount || 0} · Joins {group.joinCount || 0} · Pending {group.pendingApprovals || 0} · Volume {group.messageVolume || 0}</p>
              <p className="truncate text-xs text-muted-foreground">{group.inviteLink || "No default invite link"}</p>
              <p className="text-xs text-muted-foreground">ID: {group.id}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      ) : (
        <EmptyState title="No groups yet" description="Create invite-only customer, onboarding, language, or regional groups before sharing links." cta="Create Group" />
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>
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
