"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AudioLines, CheckCircle2, FileText, FileImage, Image, MapPin, MessageSquare, Send, UploadCloud, Video } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { dedupedAdminErrorToast } from "@/lib/client/admin-toast"
import { readJsonResponse } from "@/lib/client/safe-json"
import { authFetch } from "@/lib/client/auth-fetch"

const TYPES = ["text", "image", "document", "audio", "video", "multiple_media", "location"] as const

type SendResult = {
  id?: string
  status?: string
  externalMessageId?: string | null
  waMessageId?: string | null
  provider?: { success?: boolean; message?: string }
}

type PhoneOption = { id: string; displayPhoneNumber: string | null; isPrimary: boolean; wabaName?: string | null }
type ContactOption = { id: string; name: string | null; phoneNumber: string }

const TYPE_ICONS: Record<(typeof TYPES)[number], React.ComponentType<{ className?: string }>> = {
  text: MessageSquare,
  image: Image,
  document: FileText,
  audio: AudioLines,
  video: Video,
  multiple_media: FileImage,
  location: MapPin,
}

export function WhatsAppGatewaySend() {
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<(SendResult & { message?: string }) | null>(null)

  const [messageType, setMessageType] = useState<(typeof TYPES)[number]>("text")
  const [contactNo, setContactNo] = useState("")
  const [contactPick, setContactPick] = useState("__custom__")
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneOption[]>([])
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [senderNumber, setSenderNumber] = useState<string[]>([])
  const [message, setMessage] = useState("")
  const [mediaUrl, setMediaUrl] = useState("")
  const [mediaName, setMediaName] = useState("")
  const [locationLat, setLocationLat] = useState("")
  const [locationLng, setLocationLng] = useState("")
  const [localFile, setLocalFile] = useState<File | null>(null)
  const [useLocalFile, setUseLocalFile] = useState(false)

  const load = useCallback(async () => {
    const [phoneResponse, contactResponse] = await Promise.all([
      fetch("/api/admin/whatsapp-gateway/phone-numbers", { headers: { "x-forwarded-for": "127.0.0.1" } }),
      fetch("/api/admin/whatsapp-gateway/contacts?page=1&pageSize=100", { headers: { "x-forwarded-for": "127.0.0.1" } }),
    ])
    const phoneBody = (await readJsonResponse<{ phoneNumbers?: PhoneOption[] }>(phoneResponse)) || {}
    const contactBody = (await readJsonResponse<{ items?: ContactOption[] }>(contactResponse)) || {}
    if (!phoneResponse.ok || !contactResponse.ok) {
      dedupedAdminErrorToast({ message: "Could not load messenger options", key: "gateway-send-load" })
    }
    setPhoneNumbers(phoneBody.phoneNumbers || [])
    setContacts(contactBody.items || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const SelectedTypeIcon = TYPE_ICONS[messageType]

  function selectedSender() {
    return senderNumber?.[0] || ""
  }

  function selectedPhoneNumber() {
    return phoneNumbers.find((phone) => phone.id === selectedSender())
  }

  const canSubmit = useMemo(() => {
    const resolvedContact = contactPick !== "__custom__" ? contacts.find((contact) => contact.id === contactPick)?.phoneNumber || "" : contactNo
    if (!resolvedContact.trim()) return false
    if (messageType === "text") return Boolean(message.trim())
    if (["image", "document", "audio", "video"].includes(messageType)) return useLocalFile ? Boolean(localFile) : Boolean(mediaUrl.trim())
    if (messageType === "multiple_media") return Boolean(mediaUrl.trim())
    if (messageType === "location") return Boolean(locationLat.trim() && locationLng.trim())
    return false
  }, [contactPick, contacts, contactNo, messageType, message, useLocalFile, localFile, mediaUrl, locationLat, locationLng])

  async function onSend() {
    setSending(true)
    setResult(null)
    try {
      const resolvedContact = contactPick !== "__custom__" ? contacts.find((contact) => contact.id === contactPick)?.phoneNumber || "" : contactNo

      if (messageType !== "location" && (["image", "document", "audio", "video"].includes(messageType)) && useLocalFile && localFile) {
        const body = new FormData()
        body.set("file_url", localFile)
        body.set("messageType", messageType)
        body.set("fileName", localFile.name)
        body.set("mimeType", localFile.type || "application/octet-stream")
        body.set("whatsappPhoneNumberId", selectedSender() || "")
        body.set("contactId", resolvedContact)
        if (message.trim()) body.set("message", message.trim())

        const response = await authFetch("/api/admin/whatsapp-gateway/send", { method: "POST", body })
        const data = (await readJsonResponse<{ message?: SendResult & { message?: string } }>(response)) || {}
        if (!response.ok) throw new Error(String((data as { error?: string })?.error || "Send failed"))
        setResult((data.message || {}) as never)
        toast.success("Message sent")
      } else {
        const payload: Record<string, unknown> = {
          messageType,
          contactNo: resolvedContact,
          message: message.trim() || undefined,
        }
        const senderId = selectedSender()
        if (senderId) {
          const phone = selectedPhoneNumber()
          payload.senderNumber = phone?.displayPhoneNumber || undefined
          payload.senderNumberId = senderId
        }
        if (messageType === "image" || messageType === "document" || messageType === "video") {
          payload.mediaUrl = mediaUrl.trim() || undefined
        }
        if (messageType === "audio") payload.mediaUrl = mediaUrl.trim() || undefined
        if (messageType === "multiple_media") {
          payload.mediaUrls = mediaUrl.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)
        }
        if (messageType === "location") {
          payload.location = { latitude: Number(locationLat), longitude: Number(locationLng) }
        }

        const response = await authFetch("/api/admin/whatsapp-gateway/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        const data = (await readJsonResponse<{ message?: SendResult & { message?: string } }>(response)) || {}
        if (!response.ok) throw new Error(String((data as { error?: string })?.error || "Send failed"))
        setResult((data.message || {}) as never)
        toast.success("Message sent")
      }
    } catch (error) {
      dedupedAdminErrorToast({ message: error instanceof Error ? error.message : "Send failed", key: "gateway-send" })
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return <Skeleton className="h-96 w-full" />
  }

  const effectiveContactNo = contactPick !== "__custom__" ? contacts.find((contact) => contact.id === contactPick)?.phoneNumber || "" : contactNo

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-center gap-3">
            <SelectedTypeIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
            <div>
              <CardTitle>Send message</CardTitle>
              <CardDescription>Send a transactional message through the configured external WhatsApp API.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Message type</Label>
            <div className="flex flex-wrap gap-2">
              {TYPES.map((type) => {
                const Icon = TYPE_ICONS[type]
                const active = messageType === type
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setMessageType(type)
                      setUseLocalFile(false)
                    }}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                      active ? "border-emerald-400 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border bg-background hover:bg-muted",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {type === "multiple_media" ? "Multiple" : type}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contactPick">Recipient</Label>
              <Select value={contactPick} onValueChange={(value) => setContactPick(value)}>
                <SelectTrigger id="contactPick" aria-label="Recipient">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__custom__">Enter a phone number</SelectItem>
                  {contacts.slice(0, 200).map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.name ? `${contact.name} · ` : ""} {contact.phoneNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactNo">
                {contactPick === "__custom__" ? "Phone number" : "Selected number"}
              </Label>
              <Input
                id="contactNo"
                value={contactPick === "__custom__" ? contactNo : effectiveContactNo}
                onChange={(event) => {
                  setContactNo(event.target.value.replace(/[^\d+]/g, "").slice(0, 16))
                }}
                disabled={contactPick !== "__custom__"}
                placeholder="919876543210"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="senderNumber">Sender</Label>
            <Select
              value={selectedSender()}
              onValueChange={(value) => {
                setSenderNumber([value])
                const phone = phoneNumbers.find((item) => item.id === value)
                if (phone) setMediaName(phone.displayPhoneNumber || "")
              }}
            >
              <SelectTrigger id="senderNumber" aria-label="Sender">
                <SelectValue placeholder="Default (from settings)" />
              </SelectTrigger>
              <SelectContent>
                {phoneNumbers.length === 0 ? <SelectItem value="__empty__" disabled>No phone numbers synced</SelectItem> : null}
                {phoneNumbers.map((phone) => (
                  <SelectItem key={phone.id} value={phone.id}>
                    {phone.displayPhoneNumber || phone.id}
                    {phone.isPrimary ? " · primary" : ""}
                    {phone.wabaName ? ` (${phone.wabaName})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Leave empty to use the default sender number configured in Settings.</p>
          </div>

          {["text", "image", "document", "video"].includes(messageType) ? (
            <div className="space-y-2">
              <Label htmlFor="message">{messageType === "image" ? "Caption" : messageType === "text" ? "Message" : "Message (optional)"}</Label>
              <Textarea id="message" value={message} onChange={(event) => setMessage(event.target.value)} rows={4} maxLength={4000} placeholder="Enter message text..." />
            </div>
          ) : null}

          {["image", "document", "audio", "video"].includes(messageType) ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Button type="button" variant={useLocalFile ? "default" : "outline"} size="sm" onClick={() => setUseLocalFile(true)} disabled={Boolean(localFile)}>
                  <UploadCloud className="h-4 w-4" /> Upload file locally
                </Button>
                <Button type="button" variant={!useLocalFile || Boolean(localFile) ? "outline" : "default"} size="sm" onClick={() => setUseLocalFile(false)}>
                  Use media URL
                </Button>
              </div>
              {useLocalFile ? (
                <div className="space-y-2">
                  <Input
                    type="file"
                    aria-label="Media file"
                    onChange={(event) => setLocalFile(event.target.files?.[0] || null)}
                    accept={messageType === "image" ? "image/*" : messageType === "audio" ? "audio/*" : messageType === "video" ? "video/*" : undefined}
                  />
                  {localFile ? (
                    <p className="text-xs text-muted-foreground">
                      {localFile.name} · {(localFile.size / 1024).toFixed(0)} KB
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="mediaUrl">Media URL</Label>
                  <Input id="mediaUrl" value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)} placeholder="https://cdn.example.com/media.jpg" />
                  <p className="text-xs text-muted-foreground">The URL is validated against private networks before submission (SSRF guard).</p>
                </div>
              )}
            </div>
          ) : null}

          {messageType === "multiple_media" ? (
            <div className="space-y-2">
              <Label htmlFor="multiMessage">Message (optional)</Label>
              <Textarea id="multiMessage" value={message} onChange={(event) => setMessage(event.target.value)} rows={2} maxLength={4000} />
              <Label htmlFor="mediaUrls">Media URLs (one per line)</Label>
              <Textarea id="mediaUrls" value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)} rows={4} placeholder={"https://cdn.example.com/a.jpg\nhttps://cdn.example.com/b.jpg"} />
            </div>
          ) : null}

          {messageType === "location" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="locationLat">Latitude</Label>
                <Input id="locationLat" value={locationLat} onChange={(event) => setLocationLat(event.target.value.replace(/[^\d.\-]/g, ""))} placeholder="28.6139" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="locationLng">Longitude</Label>
                <Input id="locationLng" value={locationLng} onChange={(event) => setLocationLng(event.target.value.replace(/[^\d.\-]/g, ""))} placeholder="77.2090" />
              </div>
            </div>
          ) : null}

          <Button onClick={onSend} disabled={sending || !canSubmit} className="w-full sm:w-auto">
            {sending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            Send Message
          </Button>

          {result ? (
            <div
              className={cn(
                "rounded-lg border p-3 text-sm",
                result.status === "sent" ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5",
              )}
            >
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className={cn("h-4 w-4", result.status === "sent" ? "text-emerald-500" : "text-destructive")} />
                {result.status === "sent" ? "Sent" : "Failed"}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {result.externalMessageId ? `External ID: ${result.externalMessageId}` : null}
                {result.waMessageId ? ` · WA message ID: ${result.waMessageId}` : null}
                {result.provider?.message ? ` · ${result.provider.message}` : ""}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Messages are recorded in <span className="font-medium text-foreground">Message History</span> with masked recipient numbers, status, latency and sanitized provider errors.
          </p>
          <p>Each send is idempotency-protected — repeating the same request does not create duplicates.</p>
          <p>Media sent as URLs is validated against the configured policy (public-only by default).</p>
          <p>
            {phoneNumbers.length === 0
              ? "No sender numbers synced yet — run Sync Connections in Settings first."
              : `${phoneNumbers.length} sender ${phoneNumbers.length === 1 ? "number" : "numbers"} available.`}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}