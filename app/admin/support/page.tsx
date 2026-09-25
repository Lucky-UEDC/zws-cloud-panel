"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useCallback, useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Attachment = { id: string; name: string; mimeType: string; sizeBytes: number; url: string; previewUrl?: string | null }
type TicketMessage = { id: string; senderType: string; body: string; createdAt: string; internalOnly?: boolean; attachments?: Attachment[] }
type Ticket = {
  id: string
  ticketNumber: string
  subject: string
  status: string
  priority: string
  category: string
  updatedAt: string
  customer: { id: string; email: string; name: string | null }
}

function appendFiles(current: File[], incoming: FileList | null) {
  const next = [...current]
  for (const file of Array.from(incoming || [])) {
    if (!next.some((item) => item.name === file.name && item.size === file.size)) next.push(file)
  }
  return next
}

function AttachmentList({ attachments = [] }: { attachments?: Attachment[] }) {
  if (!attachments.length) return null
  return (
    <div className="mt-3 grid gap-2 md:grid-cols-3">
      {attachments.map((file) => {
        const isImage = file.mimeType.startsWith("image/")
        return (
          <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="rounded-lg border border-border/40 bg-background/40 p-2 text-sm transition-colors hover:bg-muted/30">
            {isImage && file.previewUrl ? <Image src={file.previewUrl} alt={file.name} width={640} height={360} unoptimized className="mb-2 aspect-video w-full rounded-md object-cover" /> : null}
            {!isImage && file.previewUrl ? <iframe src={file.previewUrl} title={file.name} className="mb-2 h-28 w-full rounded-md bg-background" /> : null}
            <span className="block truncate font-medium">{file.name}</span>
            <span className="text-xs text-muted-foreground">Attachment · {Math.ceil(file.sizeBytes / 1024)} KB</span>
          </a>
        )
      })}
    </div>
  )
}

export default function AdminSupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [messages, setMessages] = useState<TicketMessage[]>([])
  const [status, setStatus] = useState("open")
  const [priority, setPriority] = useState("medium")
  const [reply, setReply] = useState("")
  const [internalOnly, setInternalOnly] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [query, setQuery] = useState("")
  const [uploading, setUploading] = useState(false)
  const selected = useMemo(() => tickets.find((ticket) => ticket.id === selectedId), [tickets, selectedId])

  const loadTickets = useCallback(async () => {
    const params = new URLSearchParams()
    if (query.trim()) params.set("q", query.trim())
    if (status && status !== "all") params.set("status", status)
    const res = await fetch(`/api/admin/tickets?${params.toString()}`, { cache: "no-store" })
    const data = await readJsonResponse<any>(res)
    if (res.ok) {
      setTickets(data.tickets || [])
      if (!selectedId && data.tickets?.length) setSelectedId(data.tickets[0].id)
    }
  }, [query, selectedId, status])

  async function loadTicket(id: string) {
    const res = await fetch(`/api/admin/tickets/${id}`, { cache: "no-store" })
    const data = await readJsonResponse<any>(res)
    if (res.ok) {
      setMessages(data.ticket?.messages || [])
      setStatus(String(data.ticket?.status || "open"))
      setPriority(String(data.ticket?.priority || "medium"))
    }
  }

  useEffect(() => { void loadTickets() }, [loadTickets])
  useEffect(() => {
    if (selectedId) void loadTicket(selectedId)
    else setMessages([])
  }, [selectedId])

  async function updateTicketMeta(nextStatus = status) {
    if (!selectedId) return
    const res = await fetch(`/api/admin/tickets/${selectedId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus, priority }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Failed to update ticket")
    toast.success("Ticket updated")
    setStatus(nextStatus)
    await loadTickets()
    await loadTicket(selectedId)
  }

  async function deleteTicket(id: string, ticketNumber: string) {
    if (!confirm(`Permanently delete ticket ${ticketNumber}?`)) return
    const res = await fetch(`/api/admin/tickets/${id}`, { method: "DELETE" })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Failed to delete ticket")
    toast.success(`Ticket ${ticketNumber} deleted`)
    if (selectedId === id) setSelectedId("")
    await loadTickets()
  }

  async function sendReply() {
    if (!selectedId || (!reply.trim() && !files.length)) return toast.error("Reply content or attachment is required")
    setUploading(true)
    const form = new FormData()
    form.set("message", reply)
    form.set("internalOnly", String(internalOnly))
    for (const file of files) form.append("attachments", file)
    const res = await fetch(`/api/admin/tickets/${selectedId}/messages`, { method: "POST", body: form }).finally(() => setUploading(false))
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Failed to send reply")
    toast.success(internalOnly ? "Internal note saved" : "Reply sent")
    setReply("")
    setInternalOnly(false)
    setFiles([])
    await loadTicket(selectedId)
    await loadTickets()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Support Tickets</h1>
          <p className="mt-1 text-muted-foreground">Manage customer conversations, attachments, notes, status, and priority.</p>
        </div>
        <div className="flex gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tickets" className="w-56" />
          <Button variant="outline" onClick={() => void loadTickets()}>Search</Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.8fr)_1.2fr]">
        <Card className="glass border-border/40">
          <CardHeader><CardTitle>Ticket Queue</CardTitle><CardDescription>Latest customer conversations.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {tickets.map((t) => (
              <div key={t.id} className="group relative flex items-center gap-2">
                <button type="button" onClick={() => setSelectedId(t.id)} className={`flex-1 rounded-lg border p-3 text-left transition-[background,border-color,color] ${selectedId === t.id ? "selected-item" : "border-[var(--border-primary)] hover:bg-[rgba(255,255,255,0.04)]"}`}>
                  <p className="font-medium">{t.ticketNumber} · {t.subject}</p>
                  <p className="text-xs text-muted-foreground">{t.customer.name || t.customer.email} · {t.status} · {t.priority} · {new Date(t.updatedAt).toLocaleString()}</p>
                </button>
                <Button variant="destructive" size="sm" className="hidden h-9 shrink-0 group-hover:flex" onClick={() => deleteTicket(t.id, t.ticketNumber)}>Delete</Button>
              </div>
            ))}
            {!tickets.length ? <p className="text-sm text-muted-foreground">No tickets found.</p> : null}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="glass border-border/40">
            <CardHeader><CardTitle>Ticket Controls</CardTitle><CardDescription>{selected ? `${selected.ticketNumber} from ${selected.customer.email}` : "Select a ticket to manage it."}</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => updateTicketMeta()} disabled={!selectedId}>Save</Button>
                <Button variant="outline" onClick={() => updateTicketMeta("open")} disabled={!selectedId}>Reopen</Button>
                <Button variant="outline" onClick={() => updateTicketMeta("closed")} disabled={!selectedId}>Close</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-border/40">
            <CardHeader><CardTitle>Conversation</CardTitle><CardDescription>{selectedId ? "Reply to customer or add an internal note." : "Select a ticket to view messages."}</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="max-h-[460px] space-y-3 overflow-auto rounded-lg border border-border/40 p-3">
                {messages.map((m) => (
                  <div key={m.id} className="rounded-md border border-border/30 bg-muted/10 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{m.senderType}{m.internalOnly ? " · internal note" : " · delivered"}</p>
                    {m.body ? <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p> : null}
                    <AttachmentList attachments={m.attachments} />
                    <p className="mt-2 text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleString()}</p>
                  </div>
                ))}
                {!messages.length ? <p className="text-sm text-muted-foreground">No messages yet.</p> : null}
              </div>
              <div className="space-y-2"><Label>Reply</Label><Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} placeholder="Write a reply to customer..." /></div>
              <div className="space-y-2">
                <Label>Attachments</Label>
                <Input type="file" multiple accept="image/*,.pdf,.log,.txt,.zip" onChange={(e) => setFiles((current) => appendFiles(current, e.target.files))} />
                {files.length ? <p className="text-xs text-muted-foreground">{files.length} Attachment{files.length === 1 ? "" : "s"} selected</p> : null}
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={internalOnly} onChange={(e) => setInternalOnly(e.target.checked)} className="size-4 rounded border-border/40 bg-background" />
                Internal note only
              </label>
              {uploading ? <p className="text-xs text-muted-foreground">Uploading reply files...</p> : null}
              <Button onClick={sendReply} disabled={!selectedId || uploading}>{uploading ? "Sending..." : "Send Reply"}</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
