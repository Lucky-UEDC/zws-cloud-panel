"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { MessageSquare, RefreshCw, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { dedupedAdminErrorToast } from "@/lib/client/admin-toast"
import { readJsonResponse } from "@/lib/client/safe-json"
import { authFetch } from "@/lib/client/auth-fetch"

type MessageItem = {
  id: string
  maskedContact: string
  messageType: string
  message: string | null
  mediaName: string | null
  status: string
  httpStatus: number | null
  latencyMs: number | null
  sanitizedError: string | null
  sentBy: string | null
  createdAt: string
}

type ListData = {
  items?: MessageItem[]
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

const STATUS_STYLES: Record<string, string> = {
  sent: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/15 text-destructive",
  sending: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  queued: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
}

export function WhatsAppGatewayMessages() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ListData | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [status, setStatus] = useState("all")
  const [messageType, setMessageType] = useState("all")
  const [phone, setPhone] = useState("")
  const [page, setPage] = useState(1)

  const load = useCallback(async (overrides: Record<string, unknown> = {}) => {
    const params = new URLSearchParams({
      page: String(overrides.page ?? page),
      pageSize: "25",
      status: String(overrides.status ?? status),
      messageType: String(overrides.messageType ?? messageType),
    })
    if (phone.trim()) params.set("phone", phone.trim())
    const response = await fetch(`/api/admin/whatsapp-gateway/messages?${params.toString()}`, { headers: { "x-forwarded-for": "127.0.0.1" } })
    const body = (await readJsonResponse<ListData>(response)) || {}
    if (!response.ok) {
      dedupedAdminErrorToast({ message: String((body as { error?: string })?.error || "Could not load message history"), key: "gateway-history" })
    }
    setData(body)
    setLoading(false)
  }, [page, status, messageType, phone])

  useEffect(() => {
    void load()
  }, [load])

  async function retryMessage(id: string) {
    setRetryingId(id)
    try {
      const response = await authFetch(`/api/admin/whatsapp-gateway/messages/${id}/retry`, { method: "POST" })
      const body = (await readJsonResponse<{ message?: { status?: string } }>(response)) || {}
      if (!response.ok) throw new Error(String((body as { error?: string })?.error || "Retry failed"))
      const message = body.message
      if (message?.status === "sent") toast.success("Message sent")
      else toast.error("Message still failed after retry")
      void load()
    } catch (error) {
      dedupedAdminErrorToast({ message: error instanceof Error ? error.message : "Retry failed", key: "gateway-retry" })
    } finally {
      setRetryingId(null)
    }
  }

  const items = useMemo(() => data?.items || [], [data])
  const totalPages = useMemo(() => data?.totalPages || 1, [data])

  if (loading) return <Skeleton className="h-96 w-full" />

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Message History</CardTitle>
          <Button variant="outline" size="sm" onClick={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)) }} disabled={refreshing}>
            {refreshing ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(value) => { setStatus(value); void load({ page: 1, status: value }) }}>
                <SelectTrigger aria-label="Status filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="sending">Sending</SelectItem>
                  <SelectItem value="queued">Queued</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={messageType} onValueChange={(value) => { setMessageType(value); void load({ page: 1, messageType: value }) }}>
                <SelectTrigger aria-label="Type filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {["text", "image", "document", "audio", "video", "location"].map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Recipient number</Label>
              <Input placeholder="Search by masked number" value={phone} onChange={(event) => setPhone(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load({ page: 1 }) }} />
            </div>
          </div>

          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
              <p className="mt-2 text-sm text-muted-foreground">No messages yet. Send one from the Send Message page.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Content</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Latency</TableHead>
                    <TableHead>Sent by</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">{item.maskedContact}</TableCell>
                      <TableCell className="text-xs capitalize">{item.messageType}</TableCell>
                      <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                        {item.mediaName || (item.messageType === "location" ? "Location" : item.message || "—")}
                      </TableCell>
                      <TableCell>
                        <Badge className={cn("capitalize", STATUS_STYLES[item.status] || "")}>{item.status}</Badge>
                        {item.sanitizedError ? (
                          <p className="mt-0.5 max-w-48 truncate text-[11px] text-destructive/80" title={item.sanitizedError}>{item.sanitizedError}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs">{item.latencyMs !== null && item.latencyMs !== undefined ? `${item.latencyMs}ms` : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.sentBy || "admin"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{String(item.createdAt).slice(0, 16).replace("T", " ")}</TableCell>
                      <TableCell className="text-right">
                        {item.status !== "sent" ? (
                          <Button variant="ghost" size="sm" onClick={() => retryMessage(item.id)} disabled={retryingId === item.id}>
                            {retryingId === item.id ? <Spinner className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                            Retry
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {data && data.total ? (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{data.total} messages</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => { setPage(page - 1); void load({ page: page - 1 }) }}>
                  Previous
                </Button>
                <span>Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => { setPage(page + 1); void load({ page: page + 1 }) }}>
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}