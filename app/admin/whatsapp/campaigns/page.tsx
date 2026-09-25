"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Inbox, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { readJsonResponse } from "@/lib/client/safe-json"
import { WhatsAppNav } from "@/components/admin/whatsapp-nav"
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, BarChart, Bar } from "recharts"

export default function WhatsAppCampaignsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [mediaAssets, setMediaAssets] = useState<any[]>([])
  const [templates, setTemplates] = useState<any[]>([])
  const [draft, setDraft] = useState({
    name: "",
    type: "image_caption",
    provider: "evolution",
    message: "",
    caption: "",
    mediaAssetId: "",
    templateId: "",
    scheduledAt: "",
    timezone: "UTC",
    minDelayMs: "8000",
    maxDelayMs: "25000",
    dailyFrequencyCap: "2",
    audienceType: "all_customers",
    productId: "",
    serviceStatus: "",
    activeClients: true,
    unpaidInvoices: false,
    country: "",
  })
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [metrics, setMetrics] = useState<any>(null)

  useEffect(() => {
    void load()
    void loadMetrics()
    void loadAssets()
    const timer = window.setInterval(() => {
      void load()
      void loadMetrics()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [])

  async function load() {
    const response = await fetch("/api/admin/whatsapp/campaigns", { cache: "no-store" })
    const data = await readJsonResponse<any>(response)
    if (response.ok) setCampaigns(data.campaigns || [])
    setLoading(false)
  }

  async function loadMetrics() {
    const response = await fetch("/api/admin/whatsapp/metrics", { cache: "no-store" })
    const data = await readJsonResponse<any>(response)
    if (response.ok) setMetrics(data)
  }

  async function loadAssets() {
    const [mediaResponse, templatesResponse] = await Promise.all([
      fetch("/api/admin/whatsapp/media", { cache: "no-store" }),
      fetch("/api/admin/whatsapp/templates", { cache: "no-store" }),
    ])
    const media = await readJsonResponse<any>(mediaResponse)
    const templateData = await readJsonResponse<any>(templatesResponse)
    if (mediaResponse.ok) setMediaAssets(media.assets || [])
    if (templatesResponse.ok) setTemplates(templateData.templates || [])
  }

  async function createCampaign() {
    setCreating(true)
    const response = await fetch("/api/admin/whatsapp/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...draft,
        audienceFilter: {
          audienceType: draft.audienceType,
          activeClients: draft.activeClients,
          unpaidInvoices: draft.unpaidInvoices,
          productId: draft.productId || undefined,
          serviceStatus: draft.serviceStatus || undefined,
          location: draft.country,
        },
        pacingPolicy: {
          minDelayMs: Number(draft.minDelayMs),
          maxDelayMs: Number(draft.maxDelayMs),
          dailyFrequencyCap: Number(draft.dailyFrequencyCap),
        },
        mediaAssetId: draft.mediaAssetId || null,
        templateId: draft.templateId || null,
      }),
    })
    const data = await readJsonResponse<any>(response)
    setCreating(false)
    if (!response.ok) {
      toast.error(data.error || "Unable to create campaign")
      return
    }
    toast.success("Campaign queued")
    setDraft((current) => ({ ...current, name: "", message: "", caption: "", scheduledAt: "" }))
    void load()
  }

  async function action(id: string, name: "pause" | "resume" | "retry-failed") {
    const response = await fetch(`/api/admin/whatsapp/campaigns/${id}/${name}`, { method: "POST" })
    const data = await readJsonResponse<any>(response)
    if (!response.ok) toast.error(data.error || "Campaign action failed")
    else toast.success("Campaign updated")
    void load()
  }

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">WhatsApp Campaigns</h1>
          <p className="text-sm text-muted-foreground">Create, schedule, pause, resume, and retry bulk WhatsApp campaigns.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/admin/whatsapp">WhatsApp</Link></Button>
          <Button asChild variant="outline"><Link href="/admin/whatsapp/logs">Logs</Link></Button>
        </div>
      </div>

      <div className="grid min-w-0 gap-3 md:grid-cols-4">
        <Metric label="Sent today" value={metrics?.analytics?.sentToday ?? 0} />
        <Metric label="Failed today" value={metrics?.analytics?.failedToday ?? 0} />
        <Metric label="Delivery rate" value={`${latestMetric(metrics?.series, "deliveryRate")}%`} />
        <Metric label="Read rate" value={`${latestMetric(metrics?.series, "readRate")}%`} />
      </div>

      <Card>
        <CardHeader><CardTitle>Campaign Studio</CardTitle></CardHeader>
        <CardContent className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label>Name</Label><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
            <div className="space-y-2"><Label>Campaign type</Label><Select value={draft.type} onValueChange={(value) => setDraft({ ...draft, type: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["text","image_caption","video_caption","document_text","carousel","button_template","onboarding_flow","otp_onboarding","drip","scheduled","recurring"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Provider</Label><Select value="evolution" onValueChange={() => setDraft({ ...draft, provider: "evolution" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="evolution">Evolution API</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>Schedule</Label><Input type="datetime-local" value={draft.scheduledAt} onChange={(e) => setDraft({ ...draft, scheduledAt: e.target.value })} /></div>
            <div className="space-y-2"><Label>Audience</Label><Select value={draft.audienceType} onValueChange={(value) => setDraft({ ...draft, audienceType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="all_customers">All Customers</SelectItem>
              <SelectItem value="active_customers">Active Customers</SelectItem>
              <SelectItem value="expired_customers">Expired Customers</SelectItem>
              <SelectItem value="no_orders">No Orders</SelectItem>
              <SelectItem value="product_owners">Specific Product Owners</SelectItem>
              <SelectItem value="service_owners">Specific Service Owners</SelectItem>
            </SelectContent></Select></div>
            <div className="space-y-2"><Label>Template</Label><Select value={draft.templateId || "none"} onValueChange={(value) => setDraft({ ...draft, templateId: value === "none" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No template</SelectItem>{templates.map((template) => <SelectItem key={template.id} value={template.key}>{template.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Media asset</Label><Select value={draft.mediaAssetId || "none"} onValueChange={(value) => setDraft({ ...draft, mediaAssetId: value === "none" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No media</SelectItem>{mediaAssets.map((asset) => <SelectItem key={asset.id} value={asset.id}>{asset.mediaType} · {asset.originalName}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2 md:col-span-2"><Label>Body</Label><Textarea rows={5} value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} placeholder="Hi {{first_name}}, your cloud update is ready." /></div>
            <div className="space-y-2 md:col-span-2"><Label>Caption</Label><Textarea rows={3} value={draft.caption} onChange={(e) => setDraft({ ...draft, caption: e.target.value })} placeholder="Caption used for image/video/document campaigns." /></div>
            <div className="grid min-w-0 gap-3 md:col-span-2 md:grid-cols-5">
              <div className="space-y-2"><Label>Min delay ms</Label><Input value={draft.minDelayMs} onChange={(e) => setDraft({ ...draft, minDelayMs: e.target.value })} /></div>
              <div className="space-y-2"><Label>Max delay ms</Label><Input value={draft.maxDelayMs} onChange={(e) => setDraft({ ...draft, maxDelayMs: e.target.value })} /></div>
              <div className="space-y-2"><Label>Daily cap</Label><Input value={draft.dailyFrequencyCap} onChange={(e) => setDraft({ ...draft, dailyFrequencyCap: e.target.value })} /></div>
              <div className="space-y-2"><Label>Country/region</Label><Input value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })} placeholder="India" /></div>
              <div className="space-y-2"><Label>Timezone</Label><Input value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} /></div>
            </div>
            <div className="grid min-w-0 gap-3 md:col-span-2 md:grid-cols-2">
              <div className="space-y-2"><Label>Product ID</Label><Input value={draft.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value })} placeholder="Required for product owners" /></div>
              <div className="space-y-2"><Label>Service Status</Label><Input value={draft.serviceStatus} onChange={(e) => setDraft({ ...draft, serviceStatus: e.target.value })} placeholder="ACTIVE, SUSPENDED, EXPIRED" /></div>
            </div>
            <div className="md:col-span-2"><Button onClick={createCampaign} disabled={creating || !draft.name || (!draft.message && !draft.caption && !draft.mediaAssetId && !draft.templateId)}>{creating ? "Creating..." : "Queue Safe Campaign"}</Button></div>
          </div>
          <div className="min-w-0 rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-sm font-medium">Mobile preview</p>
            <div className="mt-3 max-w-full rounded-[2rem] border bg-[#0b141a] p-4 text-sm text-slate-100">
              {draft.mediaAssetId ? <div className="mb-3 flex h-36 items-center justify-center rounded-lg bg-slate-800 text-slate-400">Media</div> : null}
              <div className="rounded-lg bg-[#202c33] p-3">
                <p className="whitespace-pre-wrap">{draft.caption || draft.message || "Your campaign message preview appears here."}</p>
              </div>
              <div className="mt-3 rounded-lg bg-[#202c33] py-2 text-center text-emerald-300">Open Dashboard</div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Consent, opt-in, frequency cap, randomized delay, and suppression checks are enforced before enqueue.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Campaigns</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {loading ? <p className="text-sm text-muted-foreground">Loading campaigns...</p> : null}
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="rounded-lg border border-border/50 p-4">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{campaign.name}</p>
                <p className="text-sm text-muted-foreground">
                  Sent {campaign.sent} / {campaign.total} · Delivered {campaign.delivered || 0} · Read {campaign.read || 0} · Failed {campaign.failed} · Pending {campaign.pending}
                </p>
                <Progress className="mt-3" value={campaign.total ? Math.round(((campaign.sent + campaign.failed + (campaign.abandoned || 0)) / campaign.total) * 100) : 0} />
                <p className="mt-2 text-xs text-muted-foreground">
                  Queued {campaign.queued || 0} · Processing {campaign.processing || 0} · Retries {campaign.retries || campaign.retryCount || 0} · Abandoned {campaign.abandoned || 0}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{campaign.status}</Badge>
                <Button size="sm" variant="outline" onClick={() => action(campaign.id, "pause")}>Pause</Button>
                <Button size="sm" variant="outline" onClick={() => action(campaign.id, "resume")}>Resume</Button>
                <Button size="sm" variant="outline" onClick={() => action(campaign.id, "retry-failed")}>Retry Failed</Button>
              </div>
              </div>
            </div>
          ))}
          {!loading && !campaigns.length ? <CampaignEmptyState /> : null}
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Sent / Failures Per Hour</CardTitle></CardHeader>
          <CardContent className="h-72 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics?.series || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" tickFormatter={(value) => new Date(value).getHours().toString().padStart(2, "0")} />
                <YAxis allowDecimals={false} />
                <Tooltip labelFormatter={(value) => new Date(String(value)).toLocaleString()} />
                <Bar dataKey="sent" fill="#10b981" />
                <Bar dataKey="failures" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Delivery, Read, Retry Trend</CardTitle></CardHeader>
          <CardContent className="h-72 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics?.series || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" tickFormatter={(value) => new Date(value).getHours().toString().padStart(2, "0")} />
                <YAxis allowDecimals={false} />
                <Tooltip labelFormatter={(value) => new Date(String(value)).toLocaleString()} />
                <Line type="monotone" dataKey="deliveryRate" stroke="#2563eb" dot={false} />
                <Line type="monotone" dataKey="readRate" stroke="#7c3aed" dot={false} />
                <Line type="monotone" dataKey="retries" stroke="#f59e0b" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function latestMetric(series: any[] | undefined, key: string) {
  if (!Array.isArray(series) || !series.length) return 0
  return Number(series[series.length - 1]?.[key] || 0)
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}

function CampaignEmptyState() {
  return (
    <Empty className="border border-dashed border-border/50 bg-background/30">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Inbox className="h-6 w-6" /></EmptyMedia>
        <EmptyTitle>No campaigns yet</EmptyTitle>
        <EmptyDescription>Create a consent-aware WhatsApp campaign with pacing, suppression checks, and delivery tracking.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" onClick={() => document.querySelector<HTMLInputElement>("input")?.focus()} className="gap-2"><Plus className="h-4 w-4" />Create Campaign</Button>
      </EmptyContent>
    </Empty>
  )
}
