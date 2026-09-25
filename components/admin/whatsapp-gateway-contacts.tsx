"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw, Search, UserPlus, Users } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { dedupedAdminErrorToast } from "@/lib/client/admin-toast"
import { readJsonResponse } from "@/lib/client/safe-json"
import { authFetch } from "@/lib/client/auth-fetch"

type ContactItem = {
  id: string
  name: string | null
  phoneNumber: string
  maskedPhone: string
  email: string | null
  createdAt: string
  messageCount: number
}

type ContactData = {
  items?: ContactItem[]
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

export function WhatsAppGatewayContacts() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ContactData | null>(null)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [phone, setPhone] = useState("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [adding, setAdding] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const load = useCallback(async (overrides: Record<string, unknown> = {}) => {
    const params = new URLSearchParams({
      page: String(overrides.page ?? page),
      pageSize: "30",
    })
    if (search.trim() || overrides.search) params.set("search", String(overrides.search ?? search))
    const response = await fetch(`/api/admin/whatsapp-gateway/contacts?${params.toString()}`, { headers: { "x-forwarded-for": "127.0.0.1" } })
    const body = (await readJsonResponse<ContactData>(response)) || {}
    if (!response.ok) {
      dedupedAdminErrorToast({ message: String((body as { error?: string })?.error || "Could not load contacts"), key: "gateway-contacts" })
    }
    setData(body)
    setLoading(false)
  }, [page, search])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  async function addContact(event: React.FormEvent) {
    event.preventDefault()
    if (!phone.trim()) return
    setAdding(true)
    try {
      const response = await authFetch("/api/admin/whatsapp-gateway/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), name: name.trim() || undefined, email: email.trim() || undefined }),
      })
      const body = (await readJsonResponse(response)) || {}
      if (!response.ok) throw new Error(String((body as { error?: string })?.error || "Could not add contact"))
      toast.success("Contact added")
      setPhone("")
      setName("")
      setEmail("")
      setRefreshKey((key) => key + 1)
    } catch (error) {
      dedupedAdminErrorToast({ message: error instanceof Error ? error.message : "Could not add contact", key: "gateway-contact-add" })
    } finally {
      setAdding(false)
    }
  }

  async function syncContacts() {
    setSyncing(true)
    try {
      const response = await authFetch("/api/admin/whatsapp-gateway/contacts", { method: "PUT" })
      const body = (await readJsonResponse<{ result?: { synced?: number; failed?: number } }>(response)) || {}
      if (!response.ok) throw new Error(String((body as { error?: string })?.error || "Sync failed"))
      const result = body.result
      toast.success(`Synced ${result?.synced ?? 0} contact(s)${result?.failed ? `, ${result.failed} failed` : ""}`)
      setRefreshKey((key) => key + 1)
    } catch (error) {
      dedupedAdminErrorToast({ message: error instanceof Error ? error.message : "Sync failed", key: "gateway-contact-sync" })
    } finally {
      setSyncing(false)
    }
  }

  const items = useMemo(() => data?.items || [], [data])
  const totalPages = useMemo(() => data?.totalPages || 1, [data])

  if (loading) return <Skeleton className="h-96 w-full" />

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-base">Add contact</CardTitle>
          <CardDescription>Phone numbers are normalized and masked. Optionally mirrored to the provider.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={addContact} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="contactPhone">Phone number</Label>
              <Input id="contactPhone" value={phone} onChange={(event) => setPhone(event.target.value.replace(/[^\d+]/g, "").slice(0, 16))} placeholder="919876543210" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contactName">Name (optional)</Label>
              <Input id="contactName" value={name} onChange={(event) => setName(event.target.value)} placeholder="Rahul Sharma" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contactEmail">Email (optional)</Label>
              <Input id="contactEmail" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="rahul@example.com" />
            </div>
            <Button type="submit" disabled={adding || !phone.trim()} className="w-full">
              {adding ? <Spinner className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              Add Contact
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Contacts</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={syncContacts} disabled={syncing}>
              {syncing ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
              Sync from provider
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by name, phone or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void load({ page: 1, search: event.currentTarget.value }) }}
            />
          </div>

          {items.length === 0 ? (
            <Empty>
              <EmptyTitle><Users className="inline h-4 w-4" /> No contacts</EmptyTitle>
              <EmptyDescription>Add a contact or sync from your provider.</EmptyDescription>
            </Empty>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Messages</TableHead>
                    <TableHead>Added</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell className="font-medium">{contact.name || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{contact.maskedPhone}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{contact.email || "—"}</TableCell>
                      <TableCell className="text-xs">{contact.messageCount}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{String(contact.createdAt).slice(0, 10)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {data && data.total ? (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{data.total} contact(s)</span>
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