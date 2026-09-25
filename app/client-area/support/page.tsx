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
import { TurnstileWidget, useTurnstileConfig } from "@/components/security/turnstile-widget"

type Attachment = { id: string; name: string; mimeType: string; sizeBytes: number; url: string; previewUrl?: string | null }
type TicketMessage = { id: string; senderType: string; body: string; createdAt: string; internalOnly?: boolean; attachments?: Attachment[] }
type Ticket = { id: string; ticketNumber: string; subject: string; status: string; priority: string; updatedAt: string; messages?: TicketMessage[] }

function AttachmentList({ attachments = [] }: { attachments?: Attachment[] }) {
  if (!attachments.length) return null
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {attachments.map((file) => {
        const isImage = file.mimeType.startsWith("image/")
        return (
          <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="rounded-lg border border-border/40 bg-background/40 p-2 text-sm transition-colors hover:bg-muted/30">
            {isImage && file.previewUrl ? <Image src={file.previewUrl} alt={file.name} width={640} height={360} unoptimized className="mb-2 aspect-video w-full rounded-md object-cover" /> : null}
            {!isImage && file.previewUrl ? <iframe src={file.previewUrl} title={file.name} className="mb-2 h-32 w-full rounded-md bg-background" /> : null}
            <span className="block truncate font-medium">{file.name}</span>
            <span className="text-xs text-muted-foreground">Uploaded File · {Math.ceil(file.sizeBytes / 1024)} KB</span>
          </a>
        )
      })}
    </div>
  )
}

function appendFiles(current: File[], incoming: FileList | null) {
  const next = [...current]
  for (const file of Array.from(incoming || [])) {
    if (!next.some((item) => item.name === file.name && item.size === file.size)) next.push(file)
  }
  return next
}

export default function ClientSupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [selectedTicketId, setSelectedTicketId] = useState("")
  const [messages, setMessages] = useState<TicketMessage[]>([])
  const [subject, setSubject] = useState("")
  const [message, setMessage] = useState("")
  const [reply, setReply] = useState("")
  const [category, setCategory] = useState("general")
  const [productId, setProductId] = useState("")
  const [products, setProducts] = useState<{ id: string; name: string }[]>([])
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [replyFiles, setReplyFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState<"ticket" | "reply" | null>(null)
  const [turnstileToken, setTurnstileToken] = useState("")
  const [turnstileReset, setTurnstileReset] = useState(0)
  const turnstile = useTurnstileConfig()
  const captchaRequired = turnstile.enabled && turnstile.protect.tickets
  const selected = useMemo(() => tickets.find((ticket) => ticket.id === selectedTicketId), [tickets, selectedTicketId])

  const loadTickets = useCallback(async () => {
    const res = await fetch("/api/client/tickets", { cache: "no-store" })
    const data = await readJsonResponse<any>(res)
    if (res.ok) {
      setTickets(data.tickets || [])
      if (!selectedTicketId && data.tickets?.length) setSelectedTicketId(data.tickets[0].id)
    }
  }, [selectedTicketId])

  const loadProducts = useCallback(async () => {
    const res = await fetch("/api/client/products", { cache: "no-store" })
    const data = await readJsonResponse<any>(res)
    if (res.ok) setProducts((data.products || []).map((p: any) => ({ id: p.id, name: p.name })))
  }, [])

  async function loadTicketDetail(id: string) {
    const res = await fetch(`/api/client/tickets/${id}`, { cache: "no-store" })
    const data = await readJsonResponse<any>(res)
    if (res.ok) setMessages((data.ticket?.messages || []).filter((m: TicketMessage) => !m.internalOnly))
  }

  useEffect(() => {
    void loadTickets()
    void loadProducts()
  }, [loadProducts, loadTickets])

  useEffect(() => {
    if (selectedTicketId) void loadTicketDetail(selectedTicketId)
    else setMessages([])
  }, [selectedTicketId])

  function formWithFiles(fields: Record<string, string>, files: File[]) {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) form.set(key, value)
    form.set("turnstileToken", turnstileToken)
    for (const file of files) form.append("attachments", file)
    return form
  }

  async function createTicket() {
    if (!subject.trim() || (!message.trim() && !newFiles.length)) return toast.error("Subject and message or attachment are required")
    setUploading("ticket")
    const res = await fetch("/api/client/tickets", {
      method: "POST",
      body: formWithFiles({ subject, message, category, productId, priority: "medium" }, newFiles),
    }).finally(() => setUploading(null))
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Failed to create ticket")
    toast.success(newFiles.length ? "Ticket created and files uploaded" : "Ticket created")
    setSubject("")
    setMessage("")
    setNewFiles([])
    setTurnstileToken("")
    setTurnstileReset((value) => value + 1)
    await loadTickets()
    if (data.ticket?.id) setSelectedTicketId(data.ticket.id)
  }

  async function sendReply() {
    if (!selectedTicketId || (!reply.trim() && !replyFiles.length)) return toast.error("Write a reply or add an attachment first")
    setUploading("reply")
    const res = await fetch(`/api/client/tickets/${selectedTicketId}/messages`, {
      method: "POST",
      body: formWithFiles({ message: reply }, replyFiles),
    }).finally(() => setUploading(null))
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Failed to send reply")
    toast.success("Reply sent")
    setReply("")
    setReplyFiles([])
    setTurnstileToken("")
    setTurnstileReset((value) => value + 1)
    await loadTicketDetail(selectedTicketId)
    await loadTickets()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Support</h1>
        <p className="mt-1 text-muted-foreground">Create and track support tickets from your control panel.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="glass border-border/40">
          <CardHeader><CardTitle>Open a Ticket</CardTitle><CardDescription>Share screenshots, logs, or PDFs with your message.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General Inquiry</SelectItem>
                    <SelectItem value="billing">Billing Issue</SelectItem>
                    <SelectItem value="technical">Technical Problem</SelectItem>
                    <SelectItem value="abuse">Abuse Report</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Related Product</Label>
                <Select value={productId || "none"} onValueChange={(value) => setProductId(value === "none" ? "" : value)}>
                  <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not related to a specific product</SelectItem>
                    {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Billing issue, deployment failure, etc." /></div>
            <div className="space-y-2"><Label>Message</Label><Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} placeholder="Describe the issue in detail..." /></div>
            <div className="space-y-2">
              <Label>Attachments</Label>
              <Input type="file" multiple accept="image/*,.pdf,.log,.txt,.zip" onChange={(e) => setNewFiles((files) => appendFiles(files, e.target.files))} />
              {newFiles.length ? <p className="text-xs text-muted-foreground">{newFiles.length} Uploaded File{newFiles.length === 1 ? "" : "s"} selected</p> : null}
            </div>
            {uploading === "ticket" ? <p className="text-xs text-muted-foreground">Uploading ticket files...</p> : null}
            <TurnstileWidget key={`ticket-${turnstileReset}`} value={turnstileToken} onChange={setTurnstileToken} action="support" surface="tickets" siteKey={turnstile.siteKey} />
            <Button onClick={createTicket} disabled={uploading !== null || (captchaRequired && !turnstileToken)}>{uploading === "ticket" ? "Creating..." : "Create Ticket"}</Button>
          </CardContent>
        </Card>

        <Card className="glass border-border/40">
          <CardHeader><CardTitle>Your Tickets</CardTitle><CardDescription>Most recent first.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {tickets.map((ticket) => (
              <button key={ticket.id} type="button" onClick={() => setSelectedTicketId(ticket.id)} className={`w-full rounded-lg border p-3 text-left transition-[background,border-color,color] ${selectedTicketId === ticket.id ? "selected-item" : "border-[var(--border-primary)] hover:bg-[rgba(255,255,255,0.04)]"}`}>
                <p className="font-medium">{ticket.ticketNumber} · {ticket.subject}</p>
                <p className="text-xs text-muted-foreground">{ticket.status} · {ticket.priority} · {new Date(ticket.updatedAt).toLocaleString()}</p>
              </button>
            ))}
            {!tickets.length ? <p className="text-sm text-muted-foreground">No tickets yet.</p> : null}
          </CardContent>
        </Card>
      </div>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>{selected ? `${selected.ticketNumber} Conversation` : "Ticket Conversation"}</CardTitle><CardDescription>{selectedTicketId ? "Replies refresh automatically when you send an update." : "Select a ticket to view messages."}</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="max-h-[460px] space-y-3 overflow-auto rounded-lg border border-border/40 p-3">
            {messages.map((m) => (
              <div key={m.id} className="rounded-md border border-border/30 bg-muted/10 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{m.senderType} · delivered</p>
                {m.body ? <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p> : null}
                <AttachmentList attachments={m.attachments} />
                <p className="mt-2 text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleString()}</p>
              </div>
            ))}
            {!messages.length ? <p className="text-sm text-muted-foreground">No conversation yet.</p> : null}
          </div>
          <div className="space-y-2"><Label>Reply</Label><Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} placeholder="Write your reply..." /></div>
          <div className="space-y-2">
            <Label>Attachments</Label>
            <Input type="file" multiple accept="image/*,.pdf,.log,.txt,.zip" onChange={(e) => setReplyFiles((files) => appendFiles(files, e.target.files))} />
            {replyFiles.length ? <p className="text-xs text-muted-foreground">{replyFiles.length} Uploaded File{replyFiles.length === 1 ? "" : "s"} selected</p> : null}
          </div>
          {uploading === "reply" ? <p className="text-xs text-muted-foreground">Uploading reply files...</p> : null}
          <Button onClick={sendReply} disabled={!selectedTicketId || uploading !== null || (captchaRequired && !turnstileToken)}>{uploading === "reply" ? "Sending..." : "Send Reply"}</Button>
        </CardContent>
      </Card>
    </div>
  )
}
