"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, Bot, FileJson, MessageSquare, RefreshCw, Save, Search, Send, Settings, Users } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { WhatsAppNav } from "@/components/admin/whatsapp-nav"
import { readJsonResponse } from "@/lib/client/safe-json"
import { cn } from "@/lib/utils"

function formatDate(value: unknown) {
  if (!value) return "-"
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString()
}

function Metric({ label, value, icon: Icon }: { label: string; value: string | number; icon: any }) {
  return (
    <Card>
      <CardContent className="flex min-h-24 items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase text-muted-foreground">{label}</p>
          <p className="mt-2 truncate text-2xl font-semibold tabular-nums">{value}</p>
        </div>
        <Icon className="h-5 w-5 shrink-0 text-accent" />
      </CardContent>
    </Card>
  )
}

export function WhatsAppOverviewPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const response = await fetch("/api/admin/whatsapp/overview", { cache: "no-store" })
    const next = await readJsonResponse<any>(response)
    if (response.ok) setData(next)
    else toast.error(next.error || "Unable to load WhatsApp overview")
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 15000)
    return () => window.clearInterval(timer)
  }, [load])

  const metrics = data?.metrics || {}
  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">WhatsApp CRM</h1>
          <p className="text-sm text-muted-foreground">Evolution API contacts, conversations, campaigns, templates, logs, and automation.</p>
        </div>
        <Button variant="outline" onClick={() => void load()} className="gap-2">
          <RefreshCw className={cn("h-4 w-4", loading ? "animate-spin" : "")} />
          Refresh
        </Button>
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Contacts" value={metrics.contacts || 0} icon={Users} />
        <Metric label="Conversations" value={metrics.conversations || 0} icon={MessageSquare} />
        <Metric label="Inbound" value={metrics.inbound || 0} icon={Activity} />
        <Metric label="Outbound" value={metrics.outbound || 0} icon={Send} />
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Campaigns" value={metrics.campaigns || 0} icon={Send} />
        <Metric label="Templates" value={metrics.templates || 0} icon={FileJson} />
        <Metric label="Auto Replies" value={metrics.autoReplies || 0} icon={Bot} />
        <Metric label="Webhook Events" value={metrics.webhookEvents || 0} icon={Settings} />
      </div>

      <Card>
        <CardHeader><CardTitle>Recent Messages</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(data?.recentMessages || []).map((message: any) => (
            <div key={message.id} className="rounded-md border border-border/40 p-3">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 truncate font-medium">{message.body || message.caption || message.mediaType || "Message"}</p>
                <Badge variant={message.direction === "inbound" ? "default" : "outline"}>{message.direction}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{message.maskedPhone || "****"} · {message.status || "-"} · {formatDate(message.createdAt)}</p>
            </div>
          ))}
          {!loading && !(data?.recentMessages || []).length ? <p className="text-sm text-muted-foreground">No WhatsApp conversation messages have been recorded yet.</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}

export function WhatsAppContactsPage() {
  const [query, setQuery] = useState("")
  const [contacts, setContacts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ pageSize: "150" })
    if (query.trim()) params.set("q", query.trim())
    const response = await fetch(`/api/admin/whatsapp/contacts?${params.toString()}`, { cache: "no-store" })
    const data = await readJsonResponse<any>(response)
    if (response.ok) setContacts(data.contacts || [])
    else toast.error(data.error || "Unable to load contacts")
    setLoading(false)
  }, [query])

  useEffect(() => { void load() }, [load])

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">WhatsApp Contacts</h1>
          <p className="text-sm text-muted-foreground">Customer-synced contacts with order, service, and last-message context.</p>
        </div>
        <Button variant="outline" onClick={() => void load()} className="gap-2"><RefreshCw className="h-4 w-4" />Sync</Button>
      </div>
      <div className="flex max-w-md items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, or phone" />
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr><th className="p-3">Name</th><th>Email</th><th>Phone</th><th>Orders</th><th>Services</th><th>Status</th><th>Last Message</th></tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id} className="border-b border-border/30">
                  <td className="p-3 font-medium">{contact.displayName || contact.customer?.name || "Customer"}</td>
                  <td>{contact.email || contact.customer?.email || "-"}</td>
                  <td className="font-mono text-xs">{contact.phone || contact.maskedPhone}</td>
                  <td>{contact.orders || 0}</td>
                  <td>{contact.services || 0}</td>
                  <td><Badge variant="outline">{contact.whatsappStatus || "unknown"}</Badge></td>
                  <td className="max-w-[280px] truncate">{contact.lastMessagePreview || "-"}<span className="ml-2 text-xs text-muted-foreground">{formatDate(contact.lastMessageAt)}</span></td>
                </tr>
              ))}
              {!loading && !contacts.length ? <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No WhatsApp contacts found.</td></tr> : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

export function WhatsAppConversationsPage() {
  const [query, setQuery] = useState("")
  const [conversations, setConversations] = useState<any[]>([])
  const [selected, setSelected] = useState<any | null>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ pageSize: "100" })
    if (query.trim()) params.set("q", query.trim())
    const response = await fetch(`/api/admin/whatsapp/conversations?${params.toString()}`, { cache: "no-store" })
    const data = await readJsonResponse<any>(response)
    if (response.ok) setConversations(data.conversations || [])
    else toast.error(data.error || "Unable to load conversations")
    setLoading(false)
  }, [query])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!selected?.id) return
    fetch(`/api/admin/whatsapp/conversations/${selected.id}/messages`, { cache: "no-store" })
      .then((res) => readJsonResponse<any>(res))
      .then((data) => setMessages(data.messages || []))
      .catch(() => setMessages([]))
  }, [selected?.id])

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div>
        <h1 className="text-2xl font-semibold">Conversations</h1>
        <p className="text-sm text-muted-foreground">Inbound and outbound WhatsApp chat history grouped by contact.</p>
      </div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Chats</CardTitle>
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" />
          </CardHeader>
          <CardContent className="space-y-2">
            {conversations.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                onClick={() => setSelected(conversation)}
                className={cn("w-full rounded-md border border-border/40 p-3 text-left hover:bg-muted/40", selected?.id === conversation.id ? "bg-muted/50" : "")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{conversation.maskedPhone}</span>
                  {conversation.unreadCount ? <Badge>{conversation.unreadCount}</Badge> : null}
                </div>
                <p className="mt-1 truncate text-sm">{conversation.lastMessageText || "-"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(conversation.lastMessageAt)}</p>
              </button>
            ))}
            {!loading && !conversations.length ? <p className="text-sm text-muted-foreground">No conversations recorded yet.</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{selected ? `Chat ${selected.maskedPhone}` : "Select a Chat"}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {messages.map((message) => (
              <div key={message.id} className={cn("max-w-[85%] rounded-lg border p-3", message.direction === "outbound" ? "ml-auto bg-cyan-500/10" : "bg-muted/30")}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={message.direction === "outbound" ? "outline" : "default"}>{message.direction}</Badge>
                  <span className="text-xs text-muted-foreground">{message.status} · {formatDate(message.createdAt)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{message.body || message.caption || message.mediaType || "Media message"}</p>
                {message.mediaUrl ? <p className="mt-1 truncate text-xs text-muted-foreground">{message.mediaType}: {message.mediaUrl}</p> : null}
              </div>
            ))}
            {selected && !messages.length ? <p className="text-sm text-muted-foreground">No messages found for this conversation.</p> : null}
            {!selected ? <p className="text-sm text-muted-foreground">Choose a conversation to inspect its full chat history.</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export function WhatsAppAutoRepliesPage() {
  const [rules, setRules] = useState<any[]>([])
  const [draft, setDraft] = useState({ name: "", keywords: "pricing, plans, windows, rdp, vps", matchMode: "contains", replyText: "", enabled: true, priority: "100" })
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const response = await fetch("/api/admin/whatsapp/auto-replies", { cache: "no-store" })
    const data = await readJsonResponse<any>(response)
    if (response.ok) setRules(data.rules || [])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function createRule() {
    const response = await fetch("/api/admin/whatsapp/auto-replies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    })
    const data = await readJsonResponse<any>(response)
    if (!response.ok) return toast.error(data.error || "Unable to create auto reply")
    toast.success("Auto reply created")
    setDraft({ name: "", keywords: "", matchMode: "contains", replyText: "", enabled: true, priority: "100" })
    await load()
  }

  async function toggle(rule: any) {
    const response = await fetch(`/api/admin/whatsapp/auto-replies/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled }),
    })
    const data = await readJsonResponse<any>(response)
    if (!response.ok) return toast.error(data.error || "Unable to update rule")
    await load()
  }

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div>
        <h1 className="text-2xl font-semibold">Auto Replies</h1>
        <p className="text-sm text-muted-foreground">Keyword-triggered replies for inbound WhatsApp conversations.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Create Auto Reply</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Name"><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Pricing inquiry" /></Field>
          <Field label="Keywords"><Input value={draft.keywords} onChange={(event) => setDraft({ ...draft, keywords: event.target.value })} /></Field>
          <Field label="Match mode">
            <select className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" value={draft.matchMode} onChange={(event) => setDraft({ ...draft, matchMode: event.target.value })}>
              <option value="contains">Contains</option>
              <option value="exact">Exact</option>
              <option value="starts_with">Starts with</option>
            </select>
          </Field>
          <Field label="Priority"><Input value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })} /></Field>
          <div className="space-y-2 md:col-span-2"><Label>Reply</Label><Textarea value={draft.replyText} onChange={(event) => setDraft({ ...draft, replyText: event.target.value })} rows={4} /></div>
          <div className="flex items-center gap-3"><Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} /><Label>Enabled</Label></div>
          <div className="md:text-right"><Button onClick={createRule} disabled={!draft.name || !draft.replyText} className="gap-2"><Save className="h-4 w-4" />Create Rule</Button></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Rules</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-md border border-border/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{rule.name}</p>
                  <p className="text-xs text-muted-foreground">{(rule.keywords || []).join(", ")} · matched {rule.matchCount || 0} times</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={rule.enabled ? "default" : "secondary"}>{rule.enabled ? "enabled" : "disabled"}</Badge>
                  <Button size="sm" variant="outline" onClick={() => void toggle(rule)}>{rule.enabled ? "Disable" : "Enable"}</Button>
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{rule.replyText}</p>
            </div>
          ))}
          {!loading && !rules.length ? <p className="text-sm text-muted-foreground">No auto reply rules yet.</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}

export function WhatsAppWebhookLogsPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const response = await fetch("/api/admin/whatsapp/webhook-logs", { cache: "no-store" })
    const data = await readJsonResponse<any>(response)
    if (response.ok) setLogs(data.logs || [])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Webhook Logs</h1>
          <p className="text-sm text-muted-foreground">Evolution inbound message, delivery, read, and media webhook events.</p>
        </div>
        <Button variant="outline" onClick={() => void load()} className="gap-2"><RefreshCw className="h-4 w-4" />Refresh</Button>
      </div>
      <Card>
        <CardContent className="space-y-3 p-4">
          {logs.map((log) => <WebhookRow key={log.id} log={log} />)}
          {loading ? <p className="text-sm text-muted-foreground">Loading webhook events...</p> : null}
          {!loading && !logs.length ? <p className="text-sm text-muted-foreground">No webhook events have been received yet.</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}

function WebhookRow({ log }: { log: any }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-border/40 p-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{log.event}</p>
        <div className="flex items-center gap-2"><Badge variant="outline">{log.status}</Badge><Badge variant="secondary">{log.direction || "event"}</Badge></div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{log.maskedPhone || "****"} · {log.providerMessageId || "-"} · {formatDate(log.createdAt)}</p>
      {log.errorMessage ? <p className="mt-2 text-sm text-destructive">{log.errorMessage}</p> : null}
      <Button size="sm" variant="ghost" className="mt-2 h-8 gap-2 px-2 text-xs" onClick={() => setOpen((value) => !value)}><FileJson className="h-3.5 w-3.5" />{open ? "Hide Raw Logs" : "Show Raw Logs"}</Button>
      {open ? <pre className="mt-2 max-w-full whitespace-pre-wrap break-words rounded bg-muted/30 p-2 text-xs">{JSON.stringify(log.payload || {}, null, 2)}</pre> : null}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>
}
