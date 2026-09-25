"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useEffect, useMemo, useState } from "react"
import { Copy, Eye, Plus, RefreshCw, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"

type Offer = {
  id: string
  name: string
  slug: string
  headline?: string | null
  description?: string | null
  planLabel?: string | null
  vcpu: number
  ramGb: number
  storageGb: number
  bandwidthTb: number | string
  baseMonthlyPrice: number | string
  offerMonthlyPrice: number | string
  billingTermsAllowed: number[]
  defaultBillingTerm: number
  maxPurchases?: number | null
  purchasesCount: number
  startsAt?: string | null
  endsAt?: string | null
  active: boolean
  featured: boolean
  osTemplateId?: string | null
  gstEnabled?: boolean
  gstPercent?: number | string
  metadata?: Record<string, any> | null
}

type OsTemplateOption = {
  id: string
  name: string
  osVersion?: string | null
  osFamily?: string | null
  familyLabel?: string | null
}

const blank = {
  name: "",
  slug: "",
  headline: "",
  description: "",
  planLabel: "",
  vcpu: "4",
  ramGb: "16",
  storageGb: "100",
  bandwidthTb: "1",
  baseMonthlyPrice: "1649",
  offerMonthlyPrice: "499",
  billingTermsAllowed: "1,3,6,12,24,36",
  defaultBillingTerm: "1",
  maxPurchases: "",
  startsAt: "",
  endsAt: "",
  gstEnabled: true,
  gstPercent: "18",
  defaultOsTemplateId: "",
  allowedOsFamilies: "ubuntu, debian, almalinux, rocky, centos",
  badgeText: "Limited launch offer\n4 vCPU\n16 GB RAM\n100 GB NVMe\n1 TB bandwidth included\nIndia datacenter\nFull root access\nGST calculated at checkout",
  heroCtaText: "Configure & Deploy Now",
  includedFeatures: "4 vCPU compute\n16 GB RAM\n100 GB NVMe storage\n1 TB bandwidth included\nFull root access\nIndia region\nSecure payment\nGST invoice",
  builtFor: "Business websites\nERP / CRM apps\nAPIs and backend services\nDevelopment environments\nVPN / private tools\nLightweight databases\nMonitoring dashboards",
  trustPoints: "Secure payment\nRoot access after deployment\nGST invoice\nNVMe-backed performance",
  previewedAt: "",
  active: false,
  featured: false,
}

function formatPrice(value: unknown) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value || 0))
}

function specs(offer: Offer) {
  return `${offer.vcpu} vCPU / ${offer.ramGb}GB RAM / ${offer.storageGb}GB`
}

export default function AdminOffersPage() {
  const [offers, setOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [osTemplates, setOsTemplates] = useState<OsTemplateOption[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Offer | null>(null)
  const [form, setForm] = useState(blank)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/offers", { cache: "no-store" })
      const body = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(body?.error || "Failed to load offers")
      setOffers(body.offers || [])
      const osRes = await fetch("/api/admin/os-templates", { cache: "no-store" })
      if (osRes.ok) {
        const osBody = await readJsonResponse<any>(osRes)
        setOsTemplates(Array.isArray(osBody?.items) ? osBody.items : [])
      }
    } catch (error: any) {
      toast.error(error?.message || "Failed to load offers")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const activeCount = useMemo(() => offers.filter((offer) => offer.active).length, [offers])

  function openEditor(offer?: Offer) {
    const metadata = offer?.metadata && typeof offer.metadata === "object" ? offer.metadata : {}
    setEditing(offer || null)
    setForm(offer ? {
      name: offer.name,
      slug: offer.slug,
      headline: offer.headline || "",
      description: offer.description || "",
      planLabel: offer.planLabel || "",
      vcpu: String(offer.vcpu),
      ramGb: String(offer.ramGb),
      storageGb: String(offer.storageGb),
      bandwidthTb: String(offer.bandwidthTb || 1),
      baseMonthlyPrice: String(offer.baseMonthlyPrice),
      offerMonthlyPrice: String(offer.offerMonthlyPrice),
      gstEnabled: offer.gstEnabled !== false,
      gstPercent: String(offer.gstPercent || 18),
      defaultOsTemplateId: offer.osTemplateId || "",
      billingTermsAllowed: Array.isArray(offer.billingTermsAllowed) ? offer.billingTermsAllowed.join(",") : "1",
      defaultBillingTerm: String(offer.defaultBillingTerm || 1),
      maxPurchases: offer.maxPurchases ? String(offer.maxPurchases) : "",
      startsAt: offer.startsAt ? offer.startsAt.slice(0, 16) : "",
      endsAt: offer.endsAt ? offer.endsAt.slice(0, 16) : "",
      allowedOsFamilies: Array.isArray(metadata.allowedOsFamilies) ? metadata.allowedOsFamilies.join(", ") : "ubuntu, debian, almalinux, rocky, centos",
      badgeText: Array.isArray(metadata.badgeText) ? metadata.badgeText.join("\n") : "",
      heroCtaText: String(metadata.heroCtaText || "Configure & Deploy Now"),
      includedFeatures: Array.isArray(metadata.includedFeatures) ? metadata.includedFeatures.join("\n") : "",
      builtFor: Array.isArray(metadata.builtFor) ? metadata.builtFor.join("\n") : "",
      trustPoints: Array.isArray(metadata.trustPoints) ? metadata.trustPoints.join("\n") : "",
      previewedAt: String(metadata.previewedAt || (offer.active ? new Date().toISOString() : "")),
      active: offer.active,
      featured: offer.featured,
    } : blank)
    setDialogOpen(true)
  }

  async function save() {
    setSaving(true)
    try {
      const payload = {
        ...form,
        vcpu: Number(form.vcpu),
        ramGb: Number(form.ramGb),
        storageGb: Number(form.storageGb),
        bandwidthTb: Number(form.bandwidthTb),
        baseMonthlyPrice: Number(form.baseMonthlyPrice),
        offerMonthlyPrice: Number(form.offerMonthlyPrice),
        originalMonthlyPrice: Number(form.baseMonthlyPrice),
        gstEnabled: Boolean(form.gstEnabled),
        gstPercent: Number(form.gstPercent),
        defaultOsTemplateId: form.defaultOsTemplateId || null,
        billingTermsAllowed: form.billingTermsAllowed.split(",").map((item) => Number(item.trim())),
        allowedBillingTerms: form.billingTermsAllowed.split(",").map((item) => Number(item.trim())),
        defaultBillingTerm: Number(form.defaultBillingTerm),
        maxPurchases: form.maxPurchases ? Number(form.maxPurchases) : null,
        startsAt: form.startsAt || null,
        endsAt: form.endsAt || null,
        active: Boolean(form.active && form.previewedAt),
        badgeText: form.badgeText,
        heroCtaText: form.heroCtaText,
        includedFeatures: form.includedFeatures,
        builtFor: form.builtFor,
        trustPoints: form.trustPoints,
        allowedOsFamilies: form.allowedOsFamilies,
        previewedAt: form.previewedAt || null,
      }
      const res = await fetch(editing ? `/api/admin/offers/${editing.id}` : "/api/admin/offers", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(body?.error || "Failed to save offer")
      toast.success(editing ? "Offer updated" : "Offer created")
      setDialogOpen(false)
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Failed to save offer")
    } finally {
      setSaving(false)
    }
  }

  async function remove(offer: Offer) {
    if (!confirm(`Delete or disable ${offer.name}?`)) return
    const res = await fetch(`/api/admin/offers/${offer.id}`, { method: "DELETE" })
    const body = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(body?.error || "Failed to delete offer")
    toast.success(body.disabled ? "Offer disabled because it has orders" : "Offer deleted")
    await load()
  }

  async function copyLink(slug: string) {
    const url = `${window.location.origin}/offer/${slug}`
    await navigator.clipboard.writeText(url)
    toast.success("Offer link copied")
  }

  function previewCurrentOffer() {
    const slug = form.slug || form.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    if (!slug) return toast.error("Add a name or slug before previewing.")
    setForm((current) => ({ ...current, previewedAt: current.previewedAt || new Date().toISOString() }))
    window.open(`/offer/${slug}`, "_blank", "noopener,noreferrer")
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Offers</h1>
          <p className="mt-1 text-muted-foreground">Create promotional cloud checkout links for campaigns and ads.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
          <Button onClick={() => openEditor()}><Plus className="mr-2 h-4 w-4" />New Offer</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass border-border/40"><CardHeader><CardTitle>{offers.length}</CardTitle><CardDescription>Total offers</CardDescription></CardHeader></Card>
        <Card className="glass border-border/40"><CardHeader><CardTitle>{activeCount}</CardTitle><CardDescription>Active offers</CardDescription></CardHeader></Card>
        <Card className="glass border-border/40"><CardHeader><CardTitle>{offers.reduce((sum, offer) => sum + Number(offer.purchasesCount || 0), 0)}</CardTitle><CardDescription>Total purchases</CardDescription></CardHeader></Card>
      </div>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Offer catalog</CardTitle><CardDescription>Share links directly in ad campaigns.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {offers.map((offer) => (
            <div key={offer.id} className="grid gap-3 rounded-xl border border-border/40 bg-background/40 p-4 lg:grid-cols-[1.4fr_1fr_1fr_auto] lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{offer.name}</p>
                  <Badge variant={offer.active ? "default" : "outline"}>{offer.active ? "Active" : "Disabled"}</Badge>
                  {offer.featured ? <Badge variant="outline">Featured</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">/offer/{offer.slug}</p>
              </div>
              <div className="text-sm">
                <p>{specs(offer)}</p>
                <p className="text-muted-foreground">{Number(offer.bandwidthTb || 0)} TB bandwidth</p>
              </div>
              <div>
                {Number(offer.baseMonthlyPrice) > Number(offer.offerMonthlyPrice) ? <p className="text-xs text-muted-foreground line-through">{formatPrice(offer.baseMonthlyPrice)}/mo</p> : null}
                <p className="text-lg font-semibold">{formatPrice(offer.offerMonthlyPrice)}/mo</p>
                <p className="text-xs text-muted-foreground">{offer.purchasesCount}{offer.maxPurchases ? ` / ${offer.maxPurchases}` : ""} purchases</p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => copyLink(offer.slug)}><Copy className="h-4 w-4" /></Button>
                <Button size="sm" variant="outline" asChild><a href={`/offer/${offer.slug}`} target="_blank"><Eye className="h-4 w-4" /></a></Button>
                <Button size="sm" variant="outline" onClick={() => openEditor(offer)}>Edit</Button>
                <Button size="sm" variant="destructive" onClick={() => remove(offer)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
          {!offers.length ? <p className="rounded-xl border border-border/40 p-6 text-center text-muted-foreground">No offers created yet.</p> : null}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Offer" : "Create Offer"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
            <Field label="Slug" value={form.slug} onChange={(slug) => setForm({ ...form, slug })} />
            <Field label="Headline" value={form.headline} onChange={(headline) => setForm({ ...form, headline })} />
            <Field label="Plan label" value={form.planLabel} onChange={(planLabel) => setForm({ ...form, planLabel })} />
            <Field label="vCPU" value={form.vcpu} onChange={(vcpu) => setForm({ ...form, vcpu })} />
            <Field label="RAM GB" value={form.ramGb} onChange={(ramGb) => setForm({ ...form, ramGb })} />
            <Field label="Storage GB" value={form.storageGb} onChange={(storageGb) => setForm({ ...form, storageGb })} />
            <Field label="Bandwidth TB" value={form.bandwidthTb} onChange={(bandwidthTb) => setForm({ ...form, bandwidthTb })} />
            <Field label="Original monthly price" value={form.baseMonthlyPrice} onChange={(baseMonthlyPrice) => setForm({ ...form, baseMonthlyPrice })} />
            <Field label="Offer monthly price" value={form.offerMonthlyPrice} onChange={(offerMonthlyPrice) => setForm({ ...form, offerMonthlyPrice })} />
            <Field label="GST percent" value={form.gstPercent} onChange={(gstPercent) => setForm({ ...form, gstPercent })} />
            <Field label="Allowed terms" value={form.billingTermsAllowed} onChange={(billingTermsAllowed) => setForm({ ...form, billingTermsAllowed })} />
            <Field label="Default term" value={form.defaultBillingTerm} onChange={(defaultBillingTerm) => setForm({ ...form, defaultBillingTerm })} />
            <Field label="Max purchases" value={form.maxPurchases} onChange={(maxPurchases) => setForm({ ...form, maxPurchases })} />
            <Field label="Starts at" type="datetime-local" value={form.startsAt} onChange={(startsAt) => setForm({ ...form, startsAt })} />
            <Field label="Ends at" type="datetime-local" value={form.endsAt} onChange={(endsAt) => setForm({ ...form, endsAt })} />
            <div className="space-y-2">
              <Label>Default OS template</Label>
              <select
                value={form.defaultOsTemplateId}
                onChange={(event) => setForm({ ...form, defaultOsTemplateId: event.target.value })}
                className="h-10 w-full rounded-md border border-border/40 bg-background px-3 text-sm"
              >
                <option value="">Auto-select recommended template</option>
                {osTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}{template.osVersion ? ` ${template.osVersion}` : ""}</option>
                ))}
              </select>
            </div>
            <Field label="Allowed OS families" value={form.allowedOsFamilies} onChange={(allowedOsFamilies) => setForm({ ...form, allowedOsFamilies })} />
            <div className="flex items-center gap-3 pt-7"><Switch checked={form.gstEnabled} onCheckedChange={(gstEnabled) => setForm({ ...form, gstEnabled })} /><Label>GST enabled</Label></div>
            <div className="flex items-center gap-3 pt-7"><Switch checked={form.active} disabled={!form.previewedAt} onCheckedChange={(active) => setForm({ ...form, active })} /><Label>Active{!form.previewedAt ? " (preview first)" : ""}</Label></div>
            <div className="flex items-center gap-3 pt-7"><Switch checked={form.featured} onCheckedChange={(featured) => setForm({ ...form, featured })} /><Label>Featured</Label></div>
            <div className="space-y-2 md:col-span-2"><Label>Description</Label><Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div>
            <div className="space-y-2 md:col-span-2"><Label>Badge text</Label><Textarea value={form.badgeText} onChange={(event) => setForm({ ...form, badgeText: event.target.value })} placeholder="One badge per line" /></div>
            <Field label="Hero CTA text" value={form.heroCtaText} onChange={(heroCtaText) => setForm({ ...form, heroCtaText })} />
            <Field label="Previewed at" value={form.previewedAt} onChange={(previewedAt) => setForm({ ...form, previewedAt })} />
            <div className="space-y-2 md:col-span-2"><Label>Included features</Label><Textarea value={form.includedFeatures} onChange={(event) => setForm({ ...form, includedFeatures: event.target.value })} placeholder="One feature per line" /></div>
            <div className="space-y-2 md:col-span-2"><Label>Built for</Label><Textarea value={form.builtFor} onChange={(event) => setForm({ ...form, builtFor: event.target.value })} placeholder="One workload per line" /></div>
            <div className="space-y-2 md:col-span-2"><Label>Trust points</Label><Textarea value={form.trustPoints} onChange={(event) => setForm({ ...form, trustPoints: event.target.value })} placeholder="One trust point per line" /></div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={previewCurrentOffer}><Eye className="mr-2 h-4 w-4" />Preview Offer</Button>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? "Saving..." : "Save Offer"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <div className="space-y-2"><Label>{label}</Label><Input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></div>
}
